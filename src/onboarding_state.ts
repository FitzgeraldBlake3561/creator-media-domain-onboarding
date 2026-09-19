export type OnboardingState = "processing" | "ready";
export type ProcessingJobState = "queued" | "running" | "completed";

export type VerificationNotice = {
  domain: string;
  verified: boolean;
};

export function nextOnboardingState(
  current: OnboardingState,
  notice: VerificationNotice,
  processingJobState: ProcessingJobState
): OnboardingState {
  if (
    current === "processing" &&
    notice.verified &&
    processingJobState === "completed"
  ) return "ready";
  return current;
}
