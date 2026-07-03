import { Howl, Howler } from 'howler';

const DEFAULT_TRACKS = {
  menu: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3', // Relaxed, chill synth
  gameplay: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3', // More active, upbeat synth
};

class MusicManager {
  private currentTrack: 'menu' | 'gameplay' | null = null;
  private sound: Howl | null = null;
  private musicEnabled: boolean = true;
  private volume: number = 0.35;
  private customTracks: { menu: string | null; gameplay: string | null } = {
    menu: null,
    gameplay: null,
  };

  constructor() {
    // Load setting from localStorage
    const savedEnabled = localStorage.getItem('viborita_music_enabled');
    if (savedEnabled !== null) {
      this.musicEnabled = savedEnabled === 'true';
    }

    const savedVolume = localStorage.getItem('viborita_music_volume');
    if (savedVolume !== null) {
      this.volume = parseFloat(savedVolume);
    }

    // Load custom generated tracks if present in localStorage
    try {
      const customMenu = localStorage.getItem('viborita_custom_music_menu');
      const customGameplay = localStorage.getItem('viborita_custom_music_gameplay');
      if (customMenu) this.customTracks.menu = customMenu;
      if (customGameplay) this.customTracks.gameplay = customGameplay;
    } catch (e) {
      console.warn('Error loading custom tracks from localStorage:', e);
    }

    // Unlocking on first interaction
    const unlock = () => {
      if (this.musicEnabled && this.currentTrack && this.sound && !this.sound.playing()) {
        try {
          if (Howler && Howler.ctx && Howler.ctx.state === 'suspended') {
            Howler.ctx.resume().then(() => {
              if (this.sound && !this.sound.playing()) {
                this.sound.play();
              }
            }).catch(err => console.warn('Context resume failed:', err));
          } else {
            this.sound.play();
          }
        } catch (e) {
          console.warn('Autoplay unlock error:', e);
        }
      }
      window.removeEventListener('click', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
    };

    window.addEventListener('click', unlock);
    window.addEventListener('touchstart', unlock);
    window.addEventListener('keydown', unlock);
  }

  isMusicEnabled() {
    return this.musicEnabled;
  }

  getVolume() {
    return this.volume;
  }

  setVolume(vol: number) {
    this.volume = vol;
    localStorage.setItem('viborita_music_volume', vol.toString());
    if (this.sound) {
      this.sound.volume(this.musicEnabled ? vol : 0);
    }
  }

  toggleMusic(enabled: boolean) {
    this.musicEnabled = enabled;
    localStorage.setItem('viborita_music_enabled', enabled.toString());
    if (this.sound) {
      this.sound.volume(enabled ? this.volume : 0);
      if (enabled && !this.sound.playing()) {
        this.sound.play();
      } else if (!enabled) {
        this.sound.pause();
      }
    } else if (enabled && this.currentTrack) {
      // If we enable and a track should be playing, start it
      this.play(this.currentTrack, true);
    }
  }

  setCustomTrack(type: 'menu' | 'gameplay', dataUrl: string) {
    this.customTracks[type] = dataUrl;
    try {
      localStorage.setItem(`viborita_custom_music_${type}`, dataUrl);
    } catch (e) {
      console.warn('Could not save custom track to localStorage (may exceed quota), keeping in memory only.', e);
    }
    
    // If the changed track is currently playing, restart it smoothly
    if (this.currentTrack === type) {
      this.play(type, true);
    }
  }

  getCustomTrack(type: 'menu' | 'gameplay') {
    return this.customTracks[type];
  }

  clearCustomTrack(type: 'menu' | 'gameplay') {
    this.customTracks[type] = null;
    localStorage.removeItem(`viborita_custom_music_${type}`);
    if (this.currentTrack === type) {
      this.play(type, true);
    }
  }

  play(trackType: 'menu' | 'gameplay', forceRestart: boolean = false) {
    if (this.currentTrack === trackType && this.sound && !forceRestart) {
      // Already playing this track
      if (this.musicEnabled && !this.sound.playing()) {
        this.sound.play();
      }
      return;
    }

    const startNewTrack = () => {
      this.currentTrack = trackType;
      const srcUrl = this.customTracks[trackType] || DEFAULT_TRACKS[trackType];
      
      this.sound = new Howl({
        src: [srcUrl],
        html5: !srcUrl.startsWith('data:'), // Use html5 audio for external urls, but standard Web Audio for base64 data URIs
        loop: true,
        volume: this.musicEnabled ? this.volume : 0,
        autoplay: this.musicEnabled,
        onloaderror: (id, err) => {
          console.error(`Error loading music track: ${trackType}`, err);
        },
        onplayerror: (id, err) => {
          console.error(`Error playing music track: ${trackType}`, err);
          
          const playOnGesture = () => {
            if (this.sound && this.currentTrack === trackType && !this.sound.playing() && this.musicEnabled) {
              try {
                if (Howler && Howler.ctx && Howler.ctx.state === 'suspended') {
                  Howler.ctx.resume().then(() => {
                    if (this.sound && !this.sound.playing()) {
                      this.sound.play();
                    }
                  }).catch(e => console.warn(e));
                } else {
                  this.sound.play();
                }
              } catch (e) {
                console.warn(e);
              }
            }
            window.removeEventListener('click', playOnGesture);
            window.removeEventListener('touchstart', playOnGesture);
          };
          window.addEventListener('click', playOnGesture);
          window.addEventListener('touchstart', playOnGesture);
        }
      });

      if (this.musicEnabled) {
        this.sound.play();
        // Fade in new track
        this.sound.fade(0, this.volume, 1000);
      }
    };

    if (this.sound) {
      const oldSound = this.sound;
      // Fade out old track then unload it
      if (this.musicEnabled && oldSound.playing()) {
        oldSound.fade(this.volume, 0, 800);
        setTimeout(() => {
          oldSound.stop();
          oldSound.unload();
        }, 850);
      } else {
        oldSound.stop();
        oldSound.unload();
      }
      this.sound = null;
      setTimeout(startNewTrack, 100);
    } else {
      startNewTrack();
    }
  }

  stop() {
    if (this.sound) {
      this.sound.stop();
    }
    this.currentTrack = null;
  }
}

export const musicManager = new MusicManager();
