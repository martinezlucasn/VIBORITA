import { Howl } from 'howler';

const SOUNDS = {
  food: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3',
  goldFood: 'https://assets.mixkit.co/active_storage/sfx/1834/1834-preview.mp3',
  death: 'https://assets.mixkit.co/active_storage/sfx/2578/2578-preview.mp3',
  boost: 'https://assets.mixkit.co/active_storage/sfx/2574/2574-preview.mp3',
  collect: 'https://assets.mixkit.co/active_storage/sfx/2021/2021-preview.mp3',
};

class SoundManager {
  private sounds: Record<string, Howl> = {};
  private boostId: number | null = null;

  constructor() {
    Object.entries(SOUNDS).forEach(([key, url]) => {
      this.sounds[key] = new Howl({
        src: [url],
        volume: key === 'goldFood' ? 0.3 : 0.5,
        preload: true,
      });
    });

    // Special config for boost (looping)
    this.sounds.boost.loop(true);
  }

  play(name: keyof typeof SOUNDS) {
    if (this.sounds[name]) {
      this.sounds[name].play();
    }
  }

  startBoost() {
    if (this.sounds.boost && !this.sounds.boost.playing()) {
      this.boostId = this.sounds.boost.play();
      this.sounds.boost.fade(0, 0.3, 200, this.boostId);
    }
  }

  stopBoost() {
    if (this.sounds.boost && this.boostId !== null) {
      this.sounds.boost.fade(0.3, 0, 200, this.boostId);
      setTimeout(() => {
        if (this.boostId !== null) {
          this.sounds.boost.stop(this.boostId);
          this.boostId = null;
        }
      }, 200);
    }
  }
}

export const soundManager = new SoundManager();
