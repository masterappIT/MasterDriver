/**
 * 提示音: a short tone made in the browser, no sound file. Browsers let a page make sound only
 * after the person has touched it, so a tap anywhere unlocks it; until then a new
 * notification is shown without sound. iPhones in silent mode stay silent.
 *
 * The tones and their timing follow Master Travel's driver app (driver_alert_tone.dart, see
 * docs/REUSE.md): 清脆雙音 (the default there too) and 柔和三音.
 */

export type AlertTone = 'crisp' | 'chime';

interface ToneShape {
  label: string;
  frequencies: number[];
  /** Seconds for all the notes together. */
  duration: number;
}

export const TONES: Record<AlertTone, ToneShape> = {
  crisp: { label: '清脆雙音', frequencies: [1397, 1760], duration: 0.64 },
  chime: { label: '柔和三音', frequencies: [659, 831, 988], duration: 2.4 },
};

const PEAK_GAIN = 0.65;
const ATTACK = 0.02;
const RELEASE = 0.18;

const SOUND_KEY = 'md.alertSound';
const TONE_KEY = 'md.alertTone';

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* the choice lasts until the page is reloaded */
  }
}

let soundOn = read(SOUND_KEY) !== 'off';
let tone: AlertTone = read(TONE_KEY) === 'chime' ? 'chime' : 'crisp';

/** On this phone only, like Master Travel: the sound is a matter of where the phone is. */
export const alertPreference = {
  get sound() {
    return soundOn;
  },
  set sound(value: boolean) {
    soundOn = value;
    write(SOUND_KEY, value ? 'on' : 'off');
  },
  get tone() {
    return tone;
  },
  set tone(value: AlertTone) {
    tone = value;
    write(TONE_KEY, value);
  },
};

type AudioContextClass = typeof AudioContext;
let context: AudioContext | null = null;

function audioContext() {
  if (context) return context;
  const Context = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext) as
    | AudioContextClass
    | undefined;
  if (!Context) return null;
  try {
    context = new Context();
  } catch {
    context = null;
  }
  return context;
}

/** Called from a tap; afterwards a tone can play without one. */
export async function unlockSound() {
  const audio = audioContext();
  if (!audio) return false;
  try {
    if (audio.state !== 'running') await audio.resume();
  } catch {
    return false;
  }
  return audio.state === 'running';
}

/**
 * Unlocks on the first tap anywhere in the page, and again on any later tap and on coming back
 * to the page: iPhones pause a page's sound when it goes to the background or a call comes in,
 * and a paused sound stays silent until it is started again.
 */
export function unlockOnFirstTouch() {
  const unlock = () => {
    if (context?.state === 'running') return;
    void unlockSound();
  };
  const resume = () => {
    // Not from a tap, so a sound never unlocked stays locked; one paused by the phone may start.
    if (document.visibilityState !== 'visible' || !context || context.state === 'running') return;
    void context.resume().catch(() => undefined);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('pageshow', resume);
}

/** Plays a tone if the sound can play now; returns whether it did. */
export function playTone(which: AlertTone = tone) {
  const audio = context;
  if (!audio || audio.state !== 'running') return false;
  const shape = TONES[which];
  const length = shape.duration / shape.frequencies.length;
  const start = audio.currentTime;
  shape.frequencies.forEach((frequency, index) => {
    const noteStart = start + index * length;
    const noteEnd = noteStart + length;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0, noteStart);
    gain.gain.linearRampToValueAtTime(PEAK_GAIN, noteStart + ATTACK);
    gain.gain.setValueAtTime(PEAK_GAIN, noteEnd - RELEASE);
    gain.gain.linearRampToValueAtTime(0, noteEnd);
    gain.connect(audio.destination);
    const oscillator = audio.createOscillator();
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(noteStart);
    oscillator.stop(noteEnd);
  });
  return true;
}

/** Sound and a short buzz (Android; iPhones do not let pages vibrate), when the driver keeps them on. */
export function alertNow() {
  if (!soundOn) return;
  playTone();
  try {
    navigator.vibrate?.(200);
  } catch {
    /* not supported */
  }
}
