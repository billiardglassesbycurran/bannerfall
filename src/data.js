// Game data: units, buildings, civilizations, difficulty, modes. Base balance ported from the prototype.
// cls: unit class used by civilization bonuses — civ (peasant), inf, arch, cav, siege, ship, hero.
export const UD = {
  peasant:   { name: 'Peasant', plural: 'Peasants', cls: 'civ', hp: 45, spd: 3.1, dmg: 4, rng: 1.2, cd: 1.3, arm: 0, cost: { f: 50 }, time: 9, rad: .38, acq: 0, desc: 'Gathers food, wood and gold. Builds.' },
  sword:     { name: 'Swordsman', plural: 'Swordsmen', cls: 'inf', hp: 125, spd: 2.9, dmg: 12, rng: 1.35, cd: 1.0, arm: 2, cost: { f: 60, g: 20 }, time: 13, rad: .42, acq: 9, melee: 1, desc: 'Sturdy all-rounder' },
  spear:     { name: 'Spearman', plural: 'Spearmen', cls: 'inf', hp: 105, spd: 3.0, dmg: 9, rng: 1.95, cd: 1.1, arm: 1, cost: { f: 35, w: 25 }, time: 11, rad: .42, acq: 9, vsHorse: 3, melee: 1, desc: '3× damage vs cavalry' },
  archer:    { name: 'Archer', plural: 'Archers', cls: 'arch', hp: 65, spd: 3.0, dmg: 8, rng: 9.5, cd: 1.6, arm: 0, cost: { w: 25, g: 45 }, time: 13, rad: .4, acq: 11, ranged: 1, desc: 'Shoots from range. Weak up close' },
  crossbow:  { name: 'Crossbowman', plural: 'Crossbowmen', cls: 'arch', hp: 75, spd: 2.7, dmg: 13, rng: 9, cd: 2.3, arm: 1, pierce: 3, cost: { w: 35, g: 50 }, time: 15, rad: .4, acq: 10, ranged: 1, bolt: 1, desc: 'Slow, hard-hitting bolts that punch through armour' },
  knight:    { name: 'Knight', plural: 'Knights', cls: 'cav', hp: 230, spd: 5.0, dmg: 16, rng: 1.75, cd: 1.15, arm: 3, cost: { f: 60, g: 75 }, time: 20, rad: .7, acq: 10, horse: 1, melee: 1, desc: 'Fast heavy cavalry' },
  lightcav:  { name: 'Light Cavalry', plural: 'Light Cavalry', cls: 'cav', hp: 120, spd: 5.8, dmg: 8, rng: 1.6, cd: 1.0, arm: 1, cost: { f: 80 }, time: 14, rad: .7, acq: 11, horse: 1, melee: 1, desc: 'Cheap, very fast raiders. Great against archers' },
  horsearcher: { name: 'Horse Archer', plural: 'Horse Archers', cls: 'cav', hp: 100, spd: 5.0, dmg: 7, rng: 7.5, cd: 1.7, arm: 1, cost: { f: 40, g: 70 }, time: 18, rad: .7, acq: 10, horse: 1, ranged: 1, desc: 'Mounted archer: shoot and run' },
  catapult:  { name: 'Catapult', plural: 'Catapults', cls: 'siege', hp: 170, spd: 1.6, dmg: 45, rng: 15, cd: 5.5, arm: 4, cost: { w: 160, g: 120 }, time: 28, rad: .95, acq: 15, ranged: 1, stone: 1, vsBld: 3, splash: 1.8, desc: 'Hurls rocks: wrecks buildings and packed troops' },
  // unique units (one per civilization)
  legion:    { name: 'Legionary', plural: 'Legionaries', cls: 'inf', hp: 150, spd: 2.8, dmg: 13, rng: 1.35, cd: 1.0, arm: 4, cost: { f: 60, g: 35 }, time: 15, rad: .42, acq: 9, melee: 1, desc: 'Roman unique: heavily armoured shield wall infantry' },
  repeater:  { name: 'Repeater', plural: 'Repeaters', cls: 'arch', hp: 60, spd: 2.9, dmg: 5, rng: 8, cd: .7, arm: 0, cost: { w: 30, g: 45 }, time: 14, rad: .4, acq: 10, ranged: 1, bolt: 1, desc: 'Chinese unique: repeating crossbow, a hail of bolts' },
  berserker: { name: 'Berserker', plural: 'Berserkers', cls: 'inf', hp: 120, spd: 3.6, dmg: 14, rng: 1.3, cd: .9, arm: 1, regen: 1.5, cost: { f: 65, g: 25 }, time: 14, rad: .42, acq: 10, melee: 1, desc: 'Norse unique: fast axe fighter that heals over time' },
  khanguard: { name: "Khan's Guard", plural: "Khan's Guard", cls: 'cav', hp: 165, spd: 5.0, dmg: 10, rng: 8, cd: 1.5, arm: 2, cost: { f: 55, g: 80 }, time: 20, rad: .7, acq: 10, horse: 1, ranged: 1, desc: 'Mongol unique: armoured horse archer' },
  crusader:  { name: 'Crusader', plural: 'Crusaders', cls: 'cav', hp: 270, spd: 4.8, dmg: 18, rng: 1.8, cd: 1.1, arm: 4, cost: { f: 70, g: 85 }, time: 22, rad: .7, acq: 10, horse: 1, melee: 1, desc: 'Frankish unique: elite armoured knight' },
  // ships (v0.6)
  fishboat:  { name: 'Fishing Boat', plural: 'Fishing Boats', cls: 'ship', hp: 80, spd: 3.3, dmg: 0, rng: 0, cd: 1, arm: 0, cost: { w: 60 }, time: 12, rad: .9, acq: 0, ship: 1, fisher: 1, desc: 'Catches fish and brings it to a Dock' },
  transport: { name: 'Transport Ship', plural: 'Transport Ships', cls: 'ship', hp: 160, spd: 3.5, dmg: 0, rng: 0, cd: 1, arm: 1, cost: { w: 100 }, time: 16, rad: 1.3, acq: 0, ship: 1, carry: 10, desc: 'Carries up to 10 units across water' },
  warship:   { name: 'Warship', plural: 'Warships', cls: 'ship', hp: 230, spd: 3.3, dmg: 9, rng: 9.5, cd: 1.5, arm: 2, cost: { w: 120, g: 50 }, time: 22, rad: 1.3, acq: 11, ship: 1, ranged: 1, desc: 'Archers on a fast galley; attacks ships and the shore' },
  hero:      { name: 'Commander', plural: 'Commanders', cls: 'hero', hp: 620, spd: 3.6, dmg: 28, rng: 1.6, cd: .85, arm: 4, cost: null, time: 0, rad: .5, acq: 10, hero: 1, melee: 1, scale: 1.15, desc: 'Your hero. Ride him into battle' },
};

export const BD = {
  hall:     { name: 'Town Hall', hp: 1800, size: 5, cost: {}, time: 60, trains: ['peasant'], pop: 10, drop: 1, atk: { dmg: 7, rng: 9, cd: 2 }, arm: 3 },
  house:    { name: 'House', hp: 320, size: 2, cost: { w: 40 }, time: 14, pop: 6, arm: 1, desc: '+6 population' },
  farm:     { name: 'Farm', hp: 200, size: 3, cost: { w: 60 }, time: 12, walk: 1, food: 300, arm: 0, desc: 'A peasant farms food from it' },
  store:    { name: 'Storehouse', hp: 450, size: 3, cost: { w: 100 }, time: 18, drop: 1, arm: 1, desc: 'Drop-off for food, wood and gold' },
  barracks: { name: 'Barracks', hp: 850, size: 4, cost: { w: 150 }, time: 24, trains: ['sword', 'spear'], arm: 2, desc: 'Trains swordsmen and spearmen' },
  range:    { name: 'Archery Range', hp: 750, size: 4, cost: { w: 150 }, time: 24, trains: ['archer', 'crossbow'], arm: 2, desc: 'Trains archers and crossbowmen' },
  stable:   { name: 'Stable', hp: 750, size: 4, cost: { w: 150, g: 50 }, time: 26, trains: ['lightcav', 'knight', 'horsearcher'], req: 'barracks', arm: 2, desc: 'Trains cavalry (needs a Barracks)' },
  workshop: { name: 'Siege Workshop', hp: 700, size: 4, cost: { w: 200, g: 60 }, time: 28, trains: ['catapult'], req: 'range', arm: 2, desc: 'Builds catapults (needs an Archery Range)' },
  tower:    { name: 'Watchtower', hp: 600, size: 2, cost: { w: 100, g: 50 }, time: 20, atk: { dmg: 11, rng: 11, cd: 1.4 }, arm: 4, desc: 'Shoots arrows at enemies' },
  dock:     { name: 'Dock', hp: 900, size: 3, cost: { w: 150 }, time: 22, trains: ['fishboat', 'transport', 'warship'], drop: 1, dock: 1, arm: 2, desc: 'Build on the shore. Builds ships, stores fish' },
};
export const BUILD_LIST = ['house', 'farm', 'store', 'barracks', 'range', 'stable', 'workshop', 'tower', 'dock'];
export const RES = { f: 'Food', w: 'Wood', g: 'Gold' };

// ---------------- civilizations ----------------
// mods: per-class multipliers. hp/dmg/spd/cost multiply; arm/rng add. bld: building HP. build: construction speed.
// gather: {f,w,g} rate multipliers; farm: food per farm; style: how their soldiers look.
export const CIVS = {
  franks: {
    name: 'Franks', motto: 'Iron-clad knights and rich farmland.', unique: { type: 'crusader', at: 'stable' },
    pros: ['Cavalry +20% hit points', 'Farms hold +25% food'], cons: ['Archers cost +15%'],
    mods: { cav: { hp: 1.2 }, arch: { cost: 1.15 } }, farm: 1.25, style: 'franks',
  },
  romans: {
    name: 'Romans', motto: 'Disciplined legions and stone walls.', unique: { type: 'legion', at: 'barracks' },
    pros: ['Infantry +1 armour', 'Buildings +25% hit points', 'Peasants build 25% faster'], cons: ['Cavalry cost +20%', 'Archers −1 range'],
    mods: { inf: { arm: 1 }, cav: { cost: 1.2 }, arch: { rng: -1 } }, bld: 1.25, build: 1.25, style: 'romans',
  },
  chinese: {
    name: 'Chinese', motto: 'Masters of the crossbow and the rice field.', unique: { type: 'repeater', at: 'range' },
    pros: ['Archers +1 range and +10% damage', 'Farms hold +50% food', 'Catapults +20% damage'], cons: ['Infantry −10% hit points'],
    mods: { arch: { rng: 1, dmg: 1.1 }, siege: { dmg: 1.2 }, inf: { hp: .9 } }, farm: 1.5, style: 'chinese',
  },
  norse: {
    name: 'Norse', motto: 'Raiders of river and sea.', unique: { type: 'berserker', at: 'barracks' },
    pros: ['Infantry move 15% faster', 'Ships +20% hit points, −20% cost', 'Wood chopping +15%'], cons: ['Archers −15% damage', 'Knights cost +20%'],
    mods: { inf: { spd: 1.15 }, ship: { hp: 1.2, cost: .8 }, arch: { dmg: .85 }, cav: { cost: 1.2 } }, gather: { w: 1.15 }, style: 'norse',
  },
  mongols: {
    name: 'Mongols', motto: 'Lords of the steppe, born in the saddle.', unique: { type: 'khanguard', at: 'stable' },
    pros: ['Cavalry 15% faster', 'Horse archers −20% cost', 'Hunters: berries gathered +20%'], cons: ['Buildings −20% hit points', 'Infantry −10% damage'],
    mods: { cav: { spd: 1.15 }, inf: { dmg: .9 } }, unitCost: { horsearcher: .8, khanguard: .8 }, bld: .8, gather: { f: 1.2 }, style: 'mongols',
  },
};
export const CIV_LIST = Object.keys(CIVS);

export const DIFF = [
  { name: 'Squire', gather: .8, first: 330, every: 170, peas: 12, mix: { inf: .5, arch: .3, cav: .2, siege: 0 }, waveMul: .7 },
  { name: 'Knight', gather: 1.1, first: 250, every: 140, peas: 16, mix: { inf: .4, arch: .3, cav: .25, siege: .05 }, waveMul: 1 },
  { name: 'Warlord', gather: 1.6, first: 190, every: 115, peas: 20, mix: { inf: .35, arch: .3, cav: .25, siege: .1 }, waveMul: 1.4 },
];

export const MODES = {
  skirmish: { name: 'Skirmish', desc: 'Build a town, gather food, wood and gold, raise an army and burn down the enemy Town Hall.' },
  battle:   { name: 'Battle', desc: 'No building — two armies meet in the field. Command from above or ride in with your Commander.' },
  survival: { name: 'Survival', desc: 'Build up and hold your town against 10 ever-larger raiding waves.' },
};
