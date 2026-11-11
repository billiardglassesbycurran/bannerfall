// Game data: units, buildings, difficulty, modes. Balance values ported from the prototype.
export const UD = {
  peasant: { name: 'Peasant', plural: 'Peasants', hp: 45, spd: 3.1, dmg: 4, rng: 1.2, cd: 1.3, arm: 0, cost: { f: 50 }, time: 9, rad: .38, acq: 0, sight: 8, desc: 'Gathers food, wood and gold. Builds.' },
  sword:   { name: 'Swordsman', plural: 'Swordsmen', hp: 125, spd: 2.9, dmg: 12, rng: 1.35, cd: 1.0, arm: 2, cost: { f: 60, g: 20 }, time: 13, rad: .42, acq: 9, sight: 9, melee: 1, desc: 'Sturdy all-rounder' },
  spear:   { name: 'Spearman', plural: 'Spearmen', hp: 105, spd: 3.0, dmg: 9, rng: 1.95, cd: 1.1, arm: 1, cost: { f: 35, w: 25 }, time: 11, rad: .42, acq: 9, sight: 9, vsHorse: 3, melee: 1, desc: '3× damage vs knights' },
  archer:  { name: 'Archer', plural: 'Archers', hp: 65, spd: 3.0, dmg: 8, rng: 9.5, cd: 1.6, arm: 0, cost: { w: 25, g: 45 }, time: 13, rad: .4, acq: 11, sight: 11, ranged: 1, desc: 'Shoots from range. Weak up close' },
  knight:  { name: 'Knight', plural: 'Knights', hp: 230, spd: 5.0, dmg: 16, rng: 1.75, cd: 1.15, arm: 3, cost: { f: 60, g: 75 }, time: 20, rad: .7, acq: 10, sight: 10, horse: 1, melee: 1, desc: 'Fast heavy cavalry' },
  hero:    { name: 'Commander', plural: 'Commanders', hp: 620, spd: 3.6, dmg: 28, rng: 1.6, cd: .85, arm: 4, cost: null, time: 0, rad: .5, acq: 10, sight: 12, hero: 1, melee: 1, scale: 1.15, desc: 'Your hero. Ride him into battle' },
};

export const BD = {
  hall:     { name: 'Town Hall', hp: 1800, size: 5, cost: {}, time: 60, trains: ['peasant'], pop: 10, drop: 1, atk: { dmg: 7, rng: 9, cd: 2 }, arm: 3 },
  house:    { name: 'House', hp: 320, size: 2, cost: { w: 40 }, time: 14, pop: 6, arm: 1, desc: '+6 population' },
  farm:     { name: 'Farm', hp: 200, size: 3, cost: { w: 60 }, time: 12, walk: 1, food: 300, arm: 0, desc: 'A peasant farms 300 food from it' },
  store:    { name: 'Storehouse', hp: 450, size: 3, cost: { w: 100 }, time: 18, drop: 1, arm: 1, desc: 'Drop-off for food, wood and gold' },
  barracks: { name: 'Barracks', hp: 850, size: 4, cost: { w: 150 }, time: 24, trains: ['sword', 'spear', 'archer'], arm: 2, desc: 'Trains foot soldiers' },
  stable:   { name: 'Stable', hp: 750, size: 4, cost: { w: 150, g: 50 }, time: 26, trains: ['knight'], req: 'barracks', arm: 2, desc: 'Trains knights (needs a Barracks)' },
  tower:    { name: 'Watchtower', hp: 600, size: 2, cost: { w: 100, g: 50 }, time: 20, atk: { dmg: 11, rng: 11, cd: 1.4 }, arm: 4, desc: 'Shoots arrows at enemies' },
};
export const BUILD_LIST = ['house', 'farm', 'store', 'barracks', 'stable', 'tower'];
export const RES = { f: 'Food', w: 'Wood', g: 'Gold' };

export const DIFF = [
  { name: 'Squire', gather: .8, first: 330, every: 170, peas: 12, mix: [.5, .2, .3, 0], waveMul: .7 },
  { name: 'Knight', gather: 1.1, first: 250, every: 140, peas: 16, mix: [.35, .25, .25, .15], waveMul: 1 },
  { name: 'Warlord', gather: 1.6, first: 190, every: 115, peas: 20, mix: [.3, .2, .25, .25], waveMul: 1.4 },
];

export const MODES = {
  skirmish: { name: 'Skirmish', desc: 'Build a town, gather food, wood and gold, raise an army and burn down the enemy Town Hall.' },
  battle:   { name: 'Battle', desc: 'No building — two armies meet in the field. Command from above or ride in with your Commander.' },
  survival: { name: 'Survival', desc: 'Build up and hold your town against 10 ever-larger raiding waves.' },
};
