#!/usr/bin/env python3
"""Make Bannerfall's unit voice lines with Piper (free, offline text-to-speech, MIT) and the LibriTTS-R voice model
(904 real speakers from public-domain audiobooks, dataset CC BY 4.0). Each role gets its own speaker, speed and pitch.

  ~/.local/bannerfall-tools/bin/python tools/voices.py

Needs the voice model in ~/.local/bannerfall-tools/voices/en_US-libritts_r-medium.onnx (+ .json), from
https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/libritts_r/medium . Writes small AAC files to
assets/voices/<role>_<kind>_<n>.m4a and assets/voices/voices.json (what exists). macOS `afconvert` does the encoding.
"""
import json, pathlib, subprocess, tempfile, wave
import numpy as np
from piper import PiperVoice, SynthesisConfig

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'voices'
MODEL = pathlib.Path.home() / '.local/bannerfall-tools/voices/en_US-libritts_r-medium.onnx'

# role: speaker ids (several = variety), speed (length_scale: >1 slower), pitch (1 = natural, .8 = lower), echo, grit
ROLES = {
    'commander': dict(spk=[132], speed=1.12, pitch=.94, echo=.22),
    'soldier': dict(spk=[288, 6], speed=1.0, pitch=.97, echo=.16),
    'knight': dict(spk=[90], speed=1.02, pitch=1.0, echo=.16),
    'archer': dict(spk=[780, 228], speed=1.0, pitch=1.0, echo=.14),
    'villager': dict(spk=[474, 0], speed=.98, pitch=1.03, echo=.1),
    'troll': dict(spk=[288], speed=1.25, pitch=.72, echo=.25, grit=.25),
    'demon': dict(spk=[552], speed=1.2, pitch=.62, echo=.4, grit=.4),
    'undead': dict(spk=[6, 288], speed=1.15, pitch=1.08, echo=.45, grit=.55, whisper=.5),
}
LINES = {
    'commander': {'select': ['I am ready.', 'The banner stands.', 'Speak, and it is done.', 'What is your command?'],
                  'move': ['Onward!', 'We march.', 'Ride on.', 'To the front.'],
                  'attack': ['Follow me!', 'With me, brothers!', 'For the realm!', 'Break their line!']},
    'soldier': {'select': ['Yes, my lord?', 'Orders?', 'Ready.', 'Steel ready, sir.'],
                'move': ['At once!', 'Moving out.', 'As you command.', 'On the double!'],
                'attack': ['Attack!', 'For glory!', 'Charge them!', 'Cut them down!']},
    'knight': {'select': ['My lord.', 'Horse and lance ready.', 'At your service.'],
               'move': ['We ride.', 'Forward!', 'Spurs in!'],
               'attack': ['Charge!', 'Lances down!', 'Ride them down!']},
    'archer': {'select': ['Bow ready.', 'Yes, my lord?', 'Eyes sharp.'],
               'move': ['Moving.', 'On my way.', 'Right away.'],
               'attack': ['Loose!', 'Draw, and loose!', 'Fire at will!']},
    'villager': {'select': ['Yes?', 'Ready to work.', 'What is it?', 'Aye?'],
                 'move': ['Right away.', 'On my way.', 'Coming.'],
                 'gather': ['Back to work.', 'Aye, aye.', 'Off I go.'],
                 'build': ['I will build it.', 'Hammer and nails!', 'Leave it to me.'],
                 'attack': ['If I must!', 'Must I?']},
    'troll': {'select': ['Hrrm?', 'Troll ready.'], 'move': ['Troll go.', 'Stomp.'], 'attack': ['Smash!', 'Crush them!']},
    'demon': {'select': ['What do you want, mortal?', 'I hunger.'], 'move': ['As you wish.', 'I go.'], 'attack': ['Burn!', 'Kneel and die!']},
    'undead': {'select': ['We rise.', 'Bones ready.'], 'move': ['We follow.', 'Onward, to the grave.'], 'attack': ['Death comes!', 'Join us!']},
}


# ---------- not voices: a dragon's roars and a battle car's engine, synthesised from scratch ----------
SR = 22050
rng = np.random.default_rng(7)
def _noise(n): return rng.standard_normal(n)
def _bandpass(x, f, q, sr=SR):
    """Resonant band-pass (biquad) with a frequency curve f (array, Hz)."""
    y = np.zeros_like(x); x1 = x2 = y1 = y2 = 0.
    for i in range(len(x)):
        w = 2 * np.pi * f[i] / sr; al = np.sin(w) / (2 * q); b0 = al; a0 = 1 + al; a1 = -2 * np.cos(w); a2 = 1 - al
        yi = (b0 * x[i] - b0 * x2 - a1 * y1 - a2 * y2) / a0; x2, x1, y2, y1 = x1, x[i], y1, yi; y[i] = yi
    return y
def roar(dur=1.6, f_lo=55, f_hi=420, rise=.25, gritk=4.0):
    """A beast's roar: a growling low tone (rough, wavering) plus breathy noise through mouth resonances that open then close."""
    n = int(SR * dur); t = np.arange(n) / SR; env = np.minimum(1, t / rise) * np.clip((dur - t) / (dur * .45), 0, 1) ** 1.3
    wob = 1 + .08 * np.sin(2 * np.pi * 7 * t) + .05 * _noise(n).cumsum() / np.sqrt(n) * 30
    f0 = f_lo * (1 + .35 * np.sin(np.pi * np.clip(t / dur, 0, 1))) * wob
    ph = 2 * np.pi * np.cumsum(f0) / SR; growl = np.sign(np.sin(ph)) * .5 + np.sin(ph * 2) * .3 + np.sin(ph * 3.01) * .2
    growl *= 1 + .6 * (np.sin(2 * np.pi * 23 * t) > 0)  # rattle
    form = f_hi * (.5 + .9 * np.sin(np.pi * np.clip(t / dur, 0, 1)))
    breath = _bandpass(_noise(n), form, 2.5) * 2.2 + _bandpass(_noise(n), form * 2.3, 4) * 1.1
    x = (growl * .55 + breath) * env
    return np.tanh(x * gritk) / np.tanh(gritk)
def engine(dur=1.3):
    """An engine revving up and settling (the Battle Car)."""
    n = int(SR * dur); t = np.arange(n) / SR; rpm = 30 + 70 * np.clip(t / .35, 0, 1) * np.exp(-np.maximum(0, t - .45) * 2.2) + 12
    ph = 2 * np.pi * np.cumsum(rpm) / SR; x = (np.sin(ph) + .6 * np.sign(np.sin(ph * 2)) + .3 * np.sin(ph * 4.02)) * (1 + .3 * _noise(n) * .2)
    x = _bandpass(x + .3 * _noise(n), np.full(n, 500.), .9) * 1.5 + x * .4
    env = np.minimum(1, t / .05) * np.clip((dur - t) / .4, 0, 1)
    return np.tanh(x * env * 2) * .9
SOUNDS = {
    'dragon': {'select': [lambda: roar(1.4, 48, 360), lambda: roar(1.1, 60, 300, .15)],
               'move': [lambda: roar(.9, 70, 260, .1, 3)],
               'attack': [lambda: roar(2.0, 42, 520, .35, 5), lambda: roar(1.7, 52, 460, .2, 5)]},
    'car': {'select': [lambda: engine(1.1)], 'move': [lambda: engine(1.4)], 'attack': [lambda: engine(.9)]},
}


def synth(v, text, spk, speed, pitch):
    """Speak, then lower/raise the pitch by resampling (said faster first so the length stays natural)."""
    chunks = list(v.synthesize(text, syn_config=SynthesisConfig(speaker_id=spk, length_scale=speed * pitch, noise_scale=.6, noise_w_scale=.7)))
    a = np.concatenate([c.audio_int16_array for c in chunks]).astype(np.float32) / 32768; sr = chunks[0].sample_rate
    if pitch != 1:
        n = int(len(a) / pitch); a = np.interp(np.linspace(0, len(a) - 1, n), np.arange(len(a)), a)
    return a, sr


def finish(a, sr, echo=.15, grit=0, whisper=0):
    if whisper: a = a * (1 - whisper) + np.sign(a) * np.abs(np.random.default_rng(3).standard_normal(len(a))) * np.abs(a) * whisper * .9  # raspy, breathy
    if grit: a = np.tanh(a * (1 + grit * 6)) / np.tanh(1 + grit * 6)  # a growl
    nz = np.nonzero(np.abs(a) > .02)[0]
    if len(nz): a = a[max(0, nz[0] - 400):nz[-1] + 1200]  # trim silence
    out = np.concatenate([a, np.zeros(int(sr * .35))])
    for d, g in ((.055, echo), (.13, echo * .55), (.23, echo * .3)):  # a short open-air echo
        k = int(sr * d); out[k:k + len(a)] += a * g
    out *= .92 / max(1e-6, np.abs(out).max())
    fade = int(sr * .02); out[:fade] *= np.linspace(0, 1, fade); out[-fade * 4:] *= np.linspace(1, 0, fade * 4)
    return out


def save(a, sr, dst):
    with tempfile.NamedTemporaryFile(suffix='.wav') as tmp:
        with wave.open(tmp.name, 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((np.clip(a, -1, 1) * 32767).astype(np.int16).tobytes())
        subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '40000', tmp.name, str(dst)], check=True)


def main():
    v = PiperVoice.load(str(MODEL)); OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob('*.m4a'): f.unlink()
    manifest = {}
    for role, lines in LINES.items():
        R = ROLES[role]; manifest[role] = {}
        for kind, texts in lines.items():
            n = 0
            for i, text in enumerate(texts):
                for s, spk in enumerate(R['spk']):
                    a, sr = synth(v, text, spk, R['speed'], R['pitch']); a = finish(a, sr, R['echo'], R.get('grit', 0), R.get('whisper', 0))
                    save(a, sr, OUT / f'{role}_{kind}_{n}.m4a'); n += 1
            manifest[role][kind] = n
    for role, kinds in SOUNDS.items():
        manifest[role] = {}
        for kind, makers in kinds.items():
            for n, make in enumerate(makers): save(finish(make(), SR, .3 if role == 'dragon' else .05), SR, OUT / f'{role}_{kind}_{n}.m4a')
            manifest[role][kind] = len(makers)
    (OUT / 'voices.json').write_text(json.dumps(manifest, separators=(',', ':')))
    size = sum(f.stat().st_size for f in OUT.glob('*.m4a'))
    print(f'{sum(sum(k.values()) for k in manifest.values())} voice lines, {size // 1024} KB in {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
