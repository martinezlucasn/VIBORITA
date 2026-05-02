import { Howl, Howler } from 'howler';

const SOUNDS = {
  food: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3',
  goldFood: 'https://assets.mixkit.co/active_storage/sfx/2017/2017-preview.mp3',
  death: 'https://assets.mixkit.co/active_storage/sfx/2578/2578-preview.mp3',
  boost: 'https://assets.mixkit.co/active_storage/sfx/2574/2574-preview.mp3',
  collect: 'https://assets.mixkit.co/active_storage/sfx/2021/2021-preview.mp3',
  powerup: 'https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3',
  plim: 'https://assets.mixkit.co/active_storage/sfx/2021/2021-preview.mp3',
  star: 'https://assets.mixkit.co/active_storage/sfx/2020/2020-preview.mp3',
};

class SoundManager {
  private sounds: Record<string, Howl> = {};
  private boostId: number | null = null;
  private sfxEnabled: boolean = true;

  constructor() {
    Object.entries(SOUNDS).forEach(([key, url]) => {
      this.sounds[key] = new Howl({
        src: [url],
        volume: key === 'goldFood' ? 0.2 : (key === 'star' ? 0.1 : 0.5),
        preload: true,
      });
    });

    // Special config for boost (looping)
    this.sounds.boost.loop(true);
  }

  toggleSFX(enabled: boolean) {
    this.sfxEnabled = enabled;
    Object.values(this.sounds).forEach(s => s.mute(!enabled));
  }

  isSFXEnabled() { return this.sfxEnabled; }

  play(name: keyof typeof SOUNDS) {
    if (this.sfxEnabled && this.sounds[name]) {
      this.sounds[name].play();
    }
  }

  startBoost() {
    if (this.sfxEnabled && this.sounds.boost && !this.sounds.boost.playing()) {
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
