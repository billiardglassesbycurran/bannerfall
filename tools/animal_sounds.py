"""Cut animal calls out of free recordings (assets/incoming/sounds, see assets/CREDITS.md) into short game clips.

  ~/.local/bannerfall-tools/bin/python tools/animal_sounds.py

Writes assets/sounds/<name>_<n>.m4a (mono AAC, small for phones) and assets/sounds/sounds.json ({name: count}).
Each clip is cut at the times below, faded in/out and brought to the same loudness; macOS `afconvert` encodes it.
Needs the `soundfile` Python package (pip install soundfile) to read .ogg/.mp3.
"""
import json, os, subprocess, tempfile
import numpy as np
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'incoming', 'sounds')
OUT = os.path.join(ROOT, 'assets', 'sounds')

# name: [(source file, start s, end s, extra gain), ...]
CLIPS = {
    'cow': [('Single_Cow_Moo.ogg', .9, 2.8, 1), ('Mudchute_cow_1.ogg', 0, 2.2, 1)],
    'sheep': [('Sheep_bleating.ogg', .5, 1.7, 1), ('Sheep_bleating.ogg', 5.5, 7.2, 1)],
    'bear': [('Bear_growl.ogg', .1, 1.1, 1), ('Bear_growl.ogg', 1.55, 2.35, 1), ('Bear_growl.ogg', 8.6, 9.5, 1)],
    'elk': [('American_Elk_Bugling.ogg', 0, 5.1, 1)],
    'eagle': [('Yellowstone_sound_library_-_Bald_Eagle_-_003.mp3', .4, 1.3, 1)],
}
RATE = 22050


def clip(path, a, b, gain):
    x, sr = sf.read(os.path.join(SRC, path), always_2d=True)
    x = x.mean(1)[int(a * sr):int(b * sr)]
    if sr != RATE:  # simple resample (linear) to a phone-friendly rate
        t = np.linspace(0, len(x) - 1, int(len(x) * RATE / sr)); x = np.interp(t, np.arange(len(x)), x)
    x = x - x.mean()
    fi, fo = int(.015 * RATE), int(.12 * RATE)
    x[:fi] *= np.linspace(0, 1, fi); x[-fo:] *= np.linspace(1, 0, fo)
    rms = np.sqrt(np.mean(x ** 2)) or 1
    x = x * min(.18 / rms, .89 / (np.abs(x).max() or 1)) * gain  # even loudness, never clipping
    return np.clip(x, -1, 1)


def main():
    os.makedirs(OUT, exist_ok=True); index = {}
    for name, parts in CLIPS.items():
        for i, (path, a, b, g) in enumerate(parts):
            x = clip(path, a, b, g)
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
                sf.write(tmp.name, x, RATE, subtype='PCM_16')
            dst = os.path.join(OUT, f'{name}_{i}.m4a')
            subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '48000', tmp.name, dst], check=True); os.unlink(tmp.name)
            print(f'{dst}: {len(x) / RATE:.1f}s, {os.path.getsize(dst) // 1024} KB')
        index[name] = len(parts)
    json.dump(index, open(os.path.join(OUT, 'sounds.json'), 'w'))
    print('sounds.json', index)


if __name__ == '__main__':
    main()
