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
    id: 'stop',
    name: 'Parar Snake',
    description: 'Permite detener la snake en su lugar indefinidamente.',
    icon: '🛑',
    rarity: 'common',
    fragmentId: 'frag_stop'
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
    id: 'autopilot',
    name: 'Piloto Automático',
    description: 'La snake recolecta puntos y esquiva obstáculos por sí sola.',
    icon: '🤖',
    rarity: 'legendary',
    fragmentId: 'frag_autopilot'
  }
];
