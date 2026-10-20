import { Capacitor, registerPlugin } from '@capacitor/core';
import { readRuntimeValue, writeRuntimeValue } from '../../platform/runtimeStorage';

interface NativeReviewPlugin {
  requestReview(): Promise<void>;
}
const NativeReview = registerPlugin<NativeReviewPlugin>('InkboundNativeReview');
const KEY = 'inkbound_native_review_prompt_v1';
const DAY = 86_400_000;
type ReviewState = { firstSeen: number; lastAsked?: number; dismissed?: boolean };
function getState(): ReviewState {
  try {
    const saved = JSON.parse(readRuntimeValue(KEY) ?? 'null') as ReviewState | null;
    if (saved && Number.isFinite(saved.firstSeen)) return saved;
  } catch { /* storage may be unavailable */ }
  return { firstSeen: Date.now() };
}
function saveState(state: ReviewState): void {
  writeRuntimeValue(KEY, JSON.stringify(state));
}
export function eligibleForNativeReview(completedSessions: number, bookCount: number): boolean {
  if (!Capacitor.isNativePlatform() || !['ios', 'android'].includes(Capacitor.getPlatform())) return false;
  const state = getState();
  if (!readRuntimeValue(KEY)) saveState(state);
  return !state.dismissed && Date.now() - state.firstSeen >= 7 * DAY
    && (!state.lastAsked || Date.now() - state.lastAsked >= 120 * DAY)
    && (completedSessions >= 3 || bookCount >= 10);
}
export function dismissNativeReview(): void {
  saveState({ ...getState(), dismissed: true });
}
export async function requestNativeReview(): Promise<void> {
  // Record before invoking OS UI; the platform may suppress the dialog.
  saveState({ ...getState(), lastAsked: Date.now(), dismissed: true });
  await NativeReview.requestReview();
}
