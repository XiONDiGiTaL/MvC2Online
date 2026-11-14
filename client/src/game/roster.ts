// The canonical 56-character Marvel vs. Capcom 2 roster (28 Marvel / 28 Capcom).
//
// IMPORTANT: this file contains *names and stat profiles only*. No Capcom or
// Marvel artwork, sprites, portraits, audio or extracted frame data is included.
// Fighters are drawn procedurally by render.ts; colours are generated from a hue
// seed, so all six colour slots per character exist without shipping any assets.
//
// The numbers below are an original balance profile for this engine, not data
// extracted from the arcade ROM.

import type { Archetype, CharacterDef } from "./types";

export const ROSTER: CharacterDef[] = [
  // ---------------- MARVEL (28) ----------------
  { id: "cable", name: "Cable", short: "CBL", side: "marvel", arch: "zoner", hp: 6200, walkF: 2.0, walkB: 1.6, jump: 9.2, weight: 1.15, hue: 205, skin: 0xe0b090, proj: true, sp: ["Viper Beam", "Hyper Viper", "Time Flip"], tagline: "Future soldier, gun pressure" },
  { id: "marrow", name: "Marrow", short: "MRW", side: "marvel", arch: "rushdown", hp: 5600, walkF: 2.6, walkB: 2.2, jump: 9.6, weight: 0.95, hue: 340, skin: 0xf0c8a8, proj: false, sp: ["Bone Rush", "Spike Storm", "Marrow Twister"], tagline: "Bone blades, close range" },
  { id: "cap", name: "Captain America", short: "CAP", side: "marvel", arch: "balanced", hp: 6200, walkF: 2.2, walkB: 1.9, jump: 9.4, weight: 1.1, hue: 215, skin: 0xf2c8a4, proj: true, sp: ["Shield Slash", "Stars & Stripes", "Final Justice"], tagline: "Shield zoning, solid footsies" },
  { id: "cyclops", name: "Cyclops", short: "CYC", side: "marvel", arch: "zoner", hp: 6000, walkF: 2.1, walkB: 1.8, jump: 9.2, weight: 1.05, hue: 50, skin: 0xeec2a0, proj: true, sp: ["Optic Blast", "Gene Splice", "Mega Optic Blast"], tagline: "Beam zoning, long range" },
  { id: "wolverine", name: "Wolverine", short: "WLV", side: "marvel", arch: "rushdown", hp: 5400, walkF: 2.8, walkB: 2.4, jump: 9.8, weight: 0.9, hue: 45, skin: 0xefc9a6, proj: false, sp: ["Berserker Slash", "Tornado Claw", "Weapon X"], tagline: "Fast rushdown, dive claw" },
  { id: "wolverine-bone", name: "Wolverine (Bone)", short: "WLB", side: "marvel", arch: "rushdown", hp: 5300, walkF: 2.8, walkB: 2.4, jump: 9.9, weight: 0.88, hue: 25, skin: 0xefc9a6, proj: false, sp: ["Bone Slash", "Drill Claw", "Berserker Barrage"], tagline: "Bone-claw variant rushdown" },
  { id: "spiderman", name: "Spider-Man", short: "SPD", side: "marvel", arch: "technical", hp: 5700, walkF: 2.5, walkB: 2.3, jump: 10.2, weight: 0.92, hue: 0, skin: 0xeec6a2, proj: true, sp: ["Web Ball", "Spider Sting", "Maximum Spider"], tagline: "Mobility, web traps, air combos" },
  { id: "hulk", name: "Hulk", short: "HLK", side: "marvel", arch: "grappler", hp: 7400, walkF: 1.5, walkB: 1.3, jump: 8.6, weight: 1.6, hue: 110, skin: 0xa8d090, proj: false, sp: ["Gamma Charge", "Gamma Wave", "Gamma Crush"], tagline: "Huge damage, slow walk" },
  { id: "ironman", name: "Iron Man", short: "IRN", side: "marvel", arch: "zoner", hp: 5900, walkF: 2.2, walkB: 1.9, jump: 9.6, weight: 1.05, hue: 350, skin: 0xf0c6a2, proj: true, sp: ["Repulsor Blast", "Smart Bomb", "Proton Cannon"], tagline: "Air mobility, beam control" },
  { id: "iceman", name: "Iceman", short: "ICE", side: "marvel", arch: "zoner", hp: 5800, walkF: 2.0, walkB: 1.8, jump: 9.3, weight: 1.0, hue: 190, skin: 0xbfe4f2, proj: true, sp: ["Ice Beam", "Frost Shield", "Absolute Zero"], tagline: "Ice projectiles, keep-away" },
  { id: "warmachine", name: "War Machine", short: "WRM", side: "marvel", arch: "zoner", hp: 6300, walkF: 2.0, walkB: 1.7, jump: 9.1, weight: 1.2, hue: 30, skin: 0xd8a880, proj: true, sp: ["Shoulder Cannon", "Landmine", "War Destroyer"], tagline: "Heavy gun zoning" },
  { id: "gambit", name: "Gambit", short: "GMB", side: "marvel", arch: "balanced", hp: 5800, walkF: 2.3, walkB: 2.0, jump: 9.4, weight: 1.0, hue: 320, skin: 0xe8bb96, proj: true, sp: ["Kinetic Card", "Cajun Strike", "Royal Flush"], tagline: "Charged cards, range pokes" },
  { id: "rogue", name: "Rogue", short: "RGE", side: "marvel", arch: "grappler", hp: 6400, walkF: 2.1, walkB: 1.8, jump: 9.4, weight: 1.2, hue: 150, skin: 0xf0c6a2, proj: false, sp: ["Power Drain", "Southern Justice", "Rogue Rush"], tagline: "Flying rush, power steal" },
  { id: "colossus", name: "Colossus", short: "CLS", side: "marvel", arch: "grappler", hp: 7200, walkF: 1.6, walkB: 1.4, jump: 8.5, weight: 1.55, hue: 15, skin: 0xd8c0a8, proj: false, sp: ["Steel Rush", "Giant Swing", "Omega Slam"], tagline: "Armoured brawler, command grab" },
  { id: "psylocke", name: "Psylocke", short: "PSY", side: "marvel", arch: "rushdown", hp: 5500, walkF: 2.7, walkB: 2.4, jump: 9.8, weight: 0.9, hue: 275, skin: 0xe8bd9a, proj: false, sp: ["Psi Blade", "Psi Trap", "Psi Storm"], tagline: "Fast sword pressure" },
  { id: "storm", name: "Storm", short: "STM", side: "marvel", arch: "technical", hp: 5600, walkF: 2.4, walkB: 2.2, jump: 10.4, weight: 0.88, hue: 220, skin: 0x8a5530, proj: true, sp: ["Lightning Strike", "Whirlwind", "Hail Storm"], tagline: "Air control, lightning" },
  { id: "silver-samurai", name: "Silver Samurai", short: "SSM", side: "marvel", arch: "balanced", hp: 6100, walkF: 2.2, walkB: 1.9, jump: 9.2, weight: 1.1, hue: 210, skin: 0xe8c0a0, proj: false, sp: ["Rai-Ko Slash", "Shuriken", "Kenji Blade"], tagline: "Long blade reach" },
  { id: "sabretooth", name: "Sabretooth", short: "SBR", side: "marvel", arch: "grappler", hp: 6700, walkF: 2.2, walkB: 1.9, jump: 9.2, weight: 1.3, hue: 40, skin: 0xe8c090, proj: false, sp: ["Wild Fang", "Berserker Claw", "Feral Rage"], tagline: "Rush grab hybrid" },
  { id: "juggernaut", name: "Juggernaut", short: "JUG", side: "marvel", arch: "grappler", hp: 7600, walkF: 1.5, walkB: 1.2, jump: 8.2, weight: 1.7, hue: 350, skin: 0xd8a888, proj: false, sp: ["Head Crush", "Juggernaut Punch", "Earthquake"], tagline: "Unstoppable charge" },
  { id: "shuma", name: "Shuma-Gorath", short: "SHU", side: "marvel", arch: "technical", hp: 6000, walkF: 2.0, walkB: 1.8, jump: 9.0, weight: 1.2, hue: 130, skin: 0x5fae8a, proj: true, sp: ["Mystic Smash", "Chaos Dimension", "Hyper Mystic Smash"], tagline: "Long limbs, weird hitboxes" },
  { id: "spiral", name: "Spiral", short: "SPR", side: "marvel", arch: "technical", hp: 5500, walkF: 2.5, walkB: 2.2, jump: 9.7, weight: 0.92, hue: 200, skin: 0x7fc4d8, proj: true, sp: ["Sword Dance", "Teleport", "Metamorphosis"], tagline: "Teleports, multi-sword" },
  { id: "blackheart", name: "Blackheart", short: "BLK", side: "marvel", arch: "zoner", hp: 6100, walkF: 1.9, walkB: 1.7, jump: 9.0, weight: 1.15, hue: 265, skin: 0x6a5a7a, proj: true, sp: ["Heart of Darkness", "Demon Rage", "Inferno"], tagline: "Summons and traps" },
  { id: "venom", name: "Venom", short: "VNM", side: "marvel", arch: "balanced", hp: 6400, walkF: 2.1, walkB: 1.8, jump: 9.3, weight: 1.25, hue: 0, skin: 0x9a8ab0, proj: true, sp: ["Venom Fang", "Web Throw", "Symbiote Rush"], tagline: "Long normals, symbiote power" },
  { id: "sentinel", name: "Sentinel", short: "SNT", side: "marvel", arch: "zoner", hp: 6600, walkF: 1.8, walkB: 1.5, jump: 8.8, weight: 1.45, hue: 250, skin: 0xb0b8c8, proj: true, sp: ["Rocket Punch", "Sentinel Force", "Hyper Sentinel Force"], tagline: "Drones and beams" },
  { id: "doom", name: "Doctor Doom", short: "DDO", side: "marvel", arch: "technical", hp: 6200, walkF: 2.0, walkB: 1.8, jump: 9.4, weight: 1.15, hue: 140, skin: 0xc8b090, proj: true, sp: ["Plasma Beam", "Foot Dive", "Doctor Doom's Light"], tagline: "Beams, dive kick, lockdown" },
  { id: "omega-red", name: "Omega Red", short: "OMR", side: "marvel", arch: "grappler", hp: 6500, walkF: 2.0, walkB: 1.7, jump: 8.9, weight: 1.35, hue: 45, skin: 0xd8b090, proj: false, sp: ["Carbonadium Coil", "Omega Strike", "Death Factor"], tagline: "Carbonadium tendrils" },
  { id: "thanos", name: "Thanos", short: "THN", side: "marvel", arch: "balanced", hp: 6800, walkF: 1.9, walkB: 1.6, jump: 8.8, weight: 1.4, hue: 285, skin: 0xa07ac0, proj: true, sp: ["Space Gem", "Bubble Burst", "Time Gem"], tagline: "Zoning with super armour" },
  { id: "magneto", name: "Magneto", short: "MAG", side: "marvel", arch: "rushdown", hp: 5400, walkF: 2.7, walkB: 2.5, jump: 10.0, weight: 0.9, hue: 260, skin: 0xf0c8a8, proj: true, sp: ["Magnetic Blast", "Hyper Grav", "Magnetic Tempest"], tagline: "Fastest air movement" },

  // ---------------- CAPCOM (28) ----------------
  { id: "ruby", name: "Ruby Heart", short: "RBY", side: "capcom", arch: "technical", hp: 5900, walkF: 2.3, walkB: 2.0, jump: 9.5, weight: 1.0, hue: 180, skin: 0xf0c8a8, proj: true, sp: ["Fleur de Lys", "Ghost Ship", "Seven Seas"], tagline: "Pirate zoning, ship summon" },
  { id: "amingo", name: "Amingo", short: "AMG", side: "capcom", arch: "grappler", hp: 6600, walkF: 2.0, walkB: 1.8, jump: 9.0, weight: 1.3, hue: 100, skin: 0xd8b870, proj: false, sp: ["Cactus Rush", "Prickle", "Cactus Carnival"], tagline: "Stretchy cactus reach" },
  { id: "sonson", name: "SonSon", short: "SSN", side: "capcom", arch: "rushdown", hp: 5400, walkF: 2.8, walkB: 2.5, jump: 9.9, weight: 0.88, hue: 20, skin: 0xd8a070, proj: false, sp: ["Staff Spin", "Monkey Flip", "Staff Barrage"], tagline: "Fast staff mobility" },
  { id: "ryu", name: "Ryu", short: "RYU", side: "capcom", arch: "balanced", hp: 6200, walkF: 2.2, walkB: 1.9, jump: 9.4, weight: 1.05, hue: 210, skin: 0xeec8a4, proj: true, sp: ["Hadoken", "Shoryuken", "Shinku Hadoken"], tagline: "Fundamentals, fireball, DP" },
  { id: "ken", name: "Ken", short: "KEN", side: "capcom", arch: "rushdown", hp: 6000, walkF: 2.5, walkB: 2.2, jump: 9.6, weight: 1.0, hue: 15, skin: 0xf0c8a4, proj: true, sp: ["Hadoken", "Shoryuken", "Shinryuken"], tagline: "Aggressive shotokan" },
  { id: "chunli", name: "Chun-Li", short: "CHN", side: "capcom", arch: "rushdown", hp: 5800, walkF: 2.6, walkB: 2.4, jump: 9.8, weight: 0.92, hue: 200, skin: 0xf0c8a8, proj: false, sp: ["Kikoken", "Hyakuretsukyaku", "Hoyokusen"], tagline: "Speed, kicks, lightning legs" },
  { id: "guile", name: "Guile", short: "GUL", side: "capcom", arch: "zoner", hp: 6300, walkF: 2.0, walkB: 1.8, jump: 9.1, weight: 1.2, hue: 90, skin: 0xf2cba6, proj: true, sp: ["Sonic Boom", "Flash Kick", "Sonic Hurricane"], tagline: "Charge zoning, anti-air" },
  { id: "zangief", name: "Zangief", short: "ZNG", side: "capcom", arch: "grappler", hp: 7400, walkF: 1.6, walkB: 1.4, jump: 8.4, weight: 1.65, hue: 0, skin: 0xe8bc94, proj: false, sp: ["Spinning Piledriver", "Banishing Flat", "Final Atomic Buster"], tagline: "Command grabs, huge HP" },
  { id: "dhalsim", name: "Dhalsim", short: "DHA", side: "capcom", arch: "zoner", hp: 5700, walkF: 1.8, walkB: 1.6, jump: 10.0, weight: 0.95, hue: 30, skin: 0xa8703c, proj: true, sp: ["Yoga Fire", "Yoga Flame", "Yoga Inferno"], tagline: "Long limbs, air control" },
  { id: "charlie", name: "Charlie", short: "CHR", side: "capcom", arch: "balanced", hp: 6100, walkF: 2.3, walkB: 2.0, jump: 9.4, weight: 1.05, hue: 55, skin: 0xf0c8a4, proj: true, sp: ["Sonic Boom", "Sommersault Kick", "Sonic Break"], tagline: "Charge, cross-up kicks" },
  { id: "sakura", name: "Sakura", short: "SKR", side: "capcom", arch: "rushdown", hp: 5700, walkF: 2.6, walkB: 2.3, jump: 9.6, weight: 0.93, hue: 330, skin: 0xf2cba8, proj: true, sp: ["Hadoken", "Shouoken", "Haru Ichiban"], tagline: "Short range pressure" },
  { id: "dan", name: "Dan", short: "DAN", side: "capcom", arch: "balanced", hp: 6000, walkF: 2.3, walkB: 2.0, jump: 9.4, weight: 1.0, hue: 350, skin: 0xf0c8a4, proj: true, sp: ["Gadoken", "Koryuken", "Hissho Buraiken"], tagline: "Saikyo style, taunts" },
  { id: "cammy", name: "Cammy", short: "CAM", side: "capcom", arch: "rushdown", hp: 5500, walkF: 2.8, walkB: 2.5, jump: 9.9, weight: 0.9, hue: 120, skin: 0xf2cba8, proj: false, sp: ["Cannon Spike", "Spiral Arrow", "Cannon Drill"], tagline: "Dive kicks, mobility" },
  { id: "bison", name: "M. Bison", short: "BSN", side: "capcom", arch: "technical", hp: 6300, walkF: 2.1, walkB: 1.9, jump: 9.2, weight: 1.15, hue: 355, skin: 0xe8bc94, proj: false, sp: ["Psycho Crusher", "Double Knee Press", "Psycho Cannon"], tagline: "Head stomp, psycho pressure" },
  { id: "akuma", name: "Akuma", short: "AKM", side: "capcom", arch: "rushdown", hp: 5600, walkF: 2.7, walkB: 2.4, jump: 9.8, weight: 0.95, hue: 10, skin: 0xe8bc94, proj: true, sp: ["Gou Hadoken", "Shoryuken", "Messatsu Gou Hadou"], tagline: "Glass cannon, huge damage" },
  { id: "jill", name: "Jill", short: "JIL", side: "capcom", arch: "technical", hp: 5900, walkF: 2.4, walkB: 2.1, jump: 9.5, weight: 1.0, hue: 160, skin: 0xf0c8a8, proj: true, sp: ["Land Mine", "Zombie Summon", "Tyrant"], tagline: "Traps and summons" },
  { id: "jin", name: "Jin", short: "JIN", side: "capcom", arch: "grappler", hp: 6500, walkF: 2.2, walkB: 1.9, jump: 9.2, weight: 1.3, hue: 0, skin: 0xf0c8a4, proj: false, sp: ["Blodia Punch", "Cyclone", "Blodia Vulcan"], tagline: "Mecha power, big damage" },
  { id: "strider", name: "Strider Hiryu", short: "STR", side: "capcom", arch: "technical", hp: 5500, walkF: 2.7, walkB: 2.5, jump: 10.2, weight: 0.9, hue: 195, skin: 0xf0c8a8, proj: false, sp: ["Ragnarok", "Formation", "Legion"], tagline: "Wall cling, air mobility" },
  { id: "hayato", name: "Hayato", short: "HAY", side: "capcom", arch: "balanced", hp: 6100, walkF: 2.3, walkB: 2.0, jump: 9.4, weight: 1.05, hue: 240, skin: 0xe8bc94, proj: true, sp: ["Plasma Cannon", "Rising Slash", "Plasma Storm"], tagline: "Sword + plasma zoning" },
  { id: "megaman", name: "Mega Man", short: "MMN", side: "capcom", arch: "zoner", hp: 5800, walkF: 2.1, walkB: 1.9, jump: 9.4, weight: 0.95, hue: 215, skin: 0x8fc8e8, proj: true, sp: ["Mega Buster", "Air Dash", "Hyper Mega Man"], tagline: "Buster zoning, rush cancel" },
  { id: "roll", name: "Roll", short: "ROL", side: "capcom", arch: "balanced", hp: 5600, walkF: 2.5, walkB: 2.2, jump: 9.6, weight: 0.9, hue: 320, skin: 0xf2cba8, proj: false, sp: ["Roll Broom", "Help Me", "Roll Sweep"], tagline: "Broom, low-damage mixups" },
  { id: "tron", name: "Tron Bonne", short: "TRN", side: "capcom", arch: "zoner", hp: 6000, walkF: 2.0, walkB: 1.8, jump: 9.2, weight: 1.15, hue: 25, skin: 0xf0c8a8, proj: true, sp: ["Gustaff", "Kobun Toss", "King Kobun"], tagline: "Drone summons, lockdown" },
  { id: "servbot", name: "Servbot", short: "SRV", side: "capcom", arch: "rushdown", hp: 5200, walkF: 2.9, walkB: 2.6, jump: 10.0, weight: 0.8, hue: 55, skin: 0xf2d08a, proj: false, sp: ["Servbot Rush", "Pile Up", "Servbot Attack"], tagline: "Tiny, fast, chaotic" },
  { id: "bbhood", name: "B.B. Hood", short: "BBH", side: "capcom", arch: "technical", hp: 5600, walkF: 2.5, walkB: 2.2, jump: 9.5, weight: 0.92, hue: 350, skin: 0xf6d0ac, proj: true, sp: ["Cartwheel", "Basket Mine", "Cruel Hunting"], tagline: "Trap projectiles, tricky" },
  { id: "felicia", name: "Felicia", short: "FEL", side: "capcom", arch: "rushdown", hp: 5400, walkF: 2.9, walkB: 2.6, jump: 10.1, weight: 0.85, hue: 195, skin: 0xf6d0ac, proj: false, sp: ["Rolling Buckler", "Delta Kick", "Please Help Me"], tagline: "Fastest ground speed" },
  { id: "morrigan", name: "Morrigan", short: "MRG", side: "capcom", arch: "technical", hp: 5700, walkF: 2.6, walkB: 2.3, jump: 9.9, weight: 0.9, hue: 285, skin: 0xe8c8b0, proj: true, sp: ["Soul Fist", "Shadow Blade", "Silhouette Blade"], tagline: "Air dash, rush mixups" },
  { id: "commando", name: "Captain Commando", short: "CMD", side: "capcom", arch: "balanced", hp: 6300, walkF: 2.3, walkB: 2.0, jump: 9.4, weight: 1.1, hue: 30, skin: 0xf0c8a4, proj: true, sp: ["Commando Fire", "Captain Corridor", "Captain Sword"], tagline: "All-rounder, great assist" },
  { id: "anakaris", name: "Anakaris", short: "ANK", side: "capcom", arch: "technical", hp: 6000, walkF: 1.9, walkB: 1.7, jump: 9.0, weight: 1.2, hue: 50, skin: 0xb8b080, proj: true, sp: ["Coffin Drop", "Sarcophagus", "Pharaoh's Curse"], tagline: "Curses, float, teleport" },
];

if (ROSTER.length !== 56) {
  // Fail loudly rather than silently shipping a short roster.
  throw new Error(`Roster must contain 56 characters, found ${ROSTER.length}`);
}

export const CHAR_INDEX: Record<string, number> = Object.fromEntries(
  ROSTER.map((c, i) => [c.id, i])
);

/** Number of colour slots per character (all unlocked). */
export const COLORS_PER_CHAR = 6;

// ---------------------------------------------------------------- palettes
function hsl(h: number, s: number, l: number): number {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(1, s));
  const ll = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) { r = c; g = x; }
  else if (hh < 120) { r = x; g = c; }
  else if (hh < 180) { g = c; b = x; }
  else if (hh < 240) { g = x; b = c; }
  else if (hh < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const to = (v: number) => Math.round((v + m) * 255);
  return (to(r) << 16) | (to(g) << 8) | to(b);
}

export interface CharColors {
  primary: number;
  secondary: number;
  accent: number;
  skin: number;
  trimmed: number;
}

/** Deterministic palette for (character, colour slot). All 6 slots always valid. */
export function colorsFor(charIdx: number, colorIdx: number): CharColors {
  const c = ROSTER[charIdx] ?? ROSTER[0];
  const slot = ((colorIdx % COLORS_PER_CHAR) + COLORS_PER_CHAR) % COLORS_PER_CHAR;
  const hue = c.hue + slot * 47; // 6 well-separated variants
  return {
    primary: hsl(hue, slot === 0 ? 0.72 : 0.68, 0.5),
    secondary: hsl(hue + 12, 0.5, 0.28),
    accent: hsl(hue + 180, 0.85, 0.62),
    skin: c.skin,
    trimmed: hsl(hue + 24, 0.9, 0.72),
  };
}

export function hex(n: number): string {
  return "#" + (n & 0xffffff).toString(16).padStart(6, "0");
}
