# Adding your own 3D models (Tripo → Blender → Bannerfall)

You can replace Bannerfall's built-in buildings, ships and trees with models you make on **tripo.com**.
Blender (already installed on this Mac) cleans each model up automatically: it sizes and centres it, cuts
the polygon count so phones stay smooth, shrinks the textures and saves a small `.glb` file the game loads.

## What can be replaced ("slots")

| Slot | What it is | Slot | What it is |
|---|---|---|---|
| `hall` | Town Hall | `fishboat` | Fishing boat |
| `house` | House | `transport` | Transport ship |
| `store` | Storehouse | `warship` | Warship |
| `barracks` | Barracks | `tree_pine` | Pine tree |
| `range` | Archery Range | `tree_oak` | Leafy tree |
| `stable` | Stable | `bush` | Berry bush |
| `workshop` | Siege Workshop | `smith` | Blacksmith |
| `tower` | Watchtower | `dock` | Dock |

Soldiers and horses can't be replaced yet. They need moving (animated) models, which is a later step.

## Option A: make it on tripo.com yourself (easiest)

1. Go to **tripo.com** and sign in.
2. Make a model from text (for example *"a medieval stone town hall with a tiled roof and a bell tower,
   game asset"*) or from a picture. Generate, and pick the version you like best.
3. Click **Download** and choose the **GLB** format.
4. Put the file in the project folder **Desktop → bannerfall → assets → incoming** (create the `incoming` folder if it's missing).
5. Tell Claude something like: *"I put town-hall.glb in incoming — use it for the Town Hall."*
   Claude prepares it with Blender, tests it in the game and publishes it.

Tips:
- Ask for **one object, no ground plane or base**, a **game asset**, in the medieval style of the game.
- For ships, say which end is the front if it looks backwards in the game. Claude can turn it.
- Check the **licence of your Tripo plan**. Free plans may limit how models can be used (for example in a game
  you share or sell). Paid plans usually allow it. It's your account, so it's your call.

## Option B: let Claude generate it through the Tripo API

This uses **Tripo API credits**, which are separate from the website and cost money per model.
See the pricing at developers.tripo3d.ai.

One-time setup:
1. Go to **developers.tripo3d.ai/en/keys**, sign in, and click to create an **API key**.
   Copy it (Tripo only shows it once).
2. In the Claude app, open the **Terminal** panel and run:
   ```
   ~/.local/bannerfall-tools/bin/python tools/models.py tripo-setup
   ```
   Paste the key when asked and press Enter. It isn't shown on screen. It's saved only on this Mac
   (in your home folder, readable only by you) and is **never** put in the project or on GitHub.

After that, you can just ask: *"Generate a new warship with Tripo."* Claude will check with you before
spending credits.

## Commands (for Claude, or if you're curious)

```
~/.local/bannerfall-tools/bin/python tools/models.py slots                    # list slots
~/.local/bannerfall-tools/bin/python tools/models.py prepare FILE SLOT        # Blender clean-up + install
~/.local/bannerfall-tools/bin/python tools/models.py tripo SLOT "description" # generate via the API + install
~/.local/bannerfall-tools/bin/python tools/models.py list | remove SLOT       # see / undo custom models
~/.local/bannerfall-tools/bin/python tools/test_game.py [--live]             # automated browser tests (Playwright)
```
Extra options: `--faces N` (polygon budget), `--yaw 90` (turn the model), `--height 6` / `--length 7` (size).
