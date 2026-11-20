import {
  createElement, Crosshair, Sprout, ShoppingBasket, Axe, TreePine, Droplet, Flame, UserPlus, Biohazard, Sun, CloudRain,
  Snowflake, CloudSun, Play, Pause, RotateCcw, FlaskConical, CircleQuestionMark, Box, Map, X, Scale, MessageCircle, Dices,
  Handshake, House, CloudFog, TrendingDown, Apple, Users, Plus, type IconNode,
} from 'lucide';

const ICONS: Record<string, IconNode> = {
  observe: Crosshair, plant: Sprout, gift: ShoppingBasket, clear: Axe, forest: TreePine, water: Droplet, fire: Flame,
  spawn: UserPlus, disease: Biohazard, drought: Sun, deluge: CloudRain, winter: Snowflake, normal: CloudSun,
  play: Play, pause: Pause, replay: RotateCcw, lab: FlaskConical, help: CircleQuestionMark, cube: Box, map: Map, close: X,
  scale: Scale, talk: MessageCircle, dice: Dices, deal: Handshake, house: House, fog: CloudFog, down: TrendingDown,
  food: Apple, group: Users, plus: Plus,
};

const cache: Record<string, string> = {};

/** Inline SVG markup for a named icon (line icons, inherit currentColor). */
export function icon(name: string, size = 18): string {
  const key = `${name}:${size}`;
  if (cache[key]) return cache[key];
  const node = ICONS[name];
  if (!node) return '';
  const el = createElement(node, { width: size, height: size, 'stroke-width': 1.6, 'aria-hidden': 'true' });
  return (cache[key] = el.outerHTML);
}

/** Replace every <i data-icon="name"> placeholder under root. */
export function hydrateIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('i[data-icon]').forEach((el) => {
    el.outerHTML = icon(el.dataset.icon!, Number(el.dataset.size) || 18);
  });
}

/** Insight emoji (from the simulation core) → line icon. */
const INSIGHT: Record<string, string> = {
  '⚖️': 'scale', '🗣️': 'talk', '🎲': 'dice', '🪓': 'clear', '🤝': 'deal', '🏘️': 'house', '🌫️': 'fog', '📉': 'down',
};
export function insightIcon(emoji: string) {
  return icon(INSIGHT[emoji] ?? 'plus', 15);
}
