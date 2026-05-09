import { Ability } from "./types";

export const ALL_ABILITIES: Ability[] = [
  {
    id: 'zoom',
    name: 'Zoom Alejado',
    description: 'Aleja la cámara para tener una visión amplia de la arena.',
    icon: '🔍',
    rarity: 'rare',
    fragmentId: 'frag_zoom'
  },
  {
    id: 'teleport',
    name: 'Teletransporte',
    description: 'Teletranspórtate a una zona segura. Deja un destello al usarla. Costo: 250 puntos.',
    icon: '🌀',
    rarity: 'legendary',
    fragmentId: 'frag_teleport'
  },
  {
    id: 'magnet',
    name: 'Imán de Puntos',
    description: 'Atrae puntos y monedas cercanos automáticamente.',
    icon: '🧲',
    rarity: 'epic',
    fragmentId: 'frag_magnet'
  },
  {
    id: 'grosor',
    name: 'Grosor Extremo',
    description: 'Duplica el grosor y colisión de tu snake de forma permanente.',
    icon: '🍕',
    rarity: 'rare',
    fragmentId: 'frag_grosor'
  },
  {
    id: 'boost_cooldown',
    name: 'Súper Impulso',
    description: 'Impulso de 5s con 30s de enfriamiento. ¡Cuidado con el humo!',
    icon: '🚨',
    rarity: 'legendary',
    fragmentId: 'frag_boost'
  }
];
