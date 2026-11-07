/**
 * Resting classes are the corrected case, and `starting:` (@starting-style) holds the state each
 * element transitions from on first paint. Reduced motion and browsers without @starting-style
 * therefore render the corrected case straight away.
 */
export const CORRECTION_MOTION = {
  replyArrives:
    "translate-y-0 transition-[opacity,translate] duration-500 ease-out delay-[1400ms] starting:translate-y-3 starting:opacity-0 motion-reduce:transition-none",
  strikeDraws: "scale-x-100 transition-[scale] duration-300 ease-out delay-[2300ms] starting:scale-x-0 motion-reduce:transition-none",
  oldValueLifts:
    "transition-[translate,scale,color] duration-500 ease-in-out delay-[2700ms] starting:translate-y-0 starting:scale-100 starting:text-danger motion-reduce:transition-none",
  newValueLands:
    "translate-y-0 transition-[opacity,translate] duration-500 ease-out delay-[2850ms] starting:-translate-y-2 starting:opacity-0 motion-reduce:transition-none",
  rowSettles:
    "transition-[background-color,border-color] duration-500 delay-[2850ms] starting:border-danger/45 starting:bg-danger-soft motion-reduce:transition-none",
  relationSettles:
    "transition-[background-color,color] duration-500 delay-[2850ms] starting:bg-danger-soft starting:text-danger motion-reduce:transition-none",
  detailBeforeFades: "opacity-0 transition-opacity duration-300 delay-[2850ms] starting:opacity-100 motion-reduce:transition-none",
  detailAfterAppears: "transition-opacity duration-300 delay-[2850ms] starting:opacity-0 motion-reduce:transition-none",
  stateBeforeFades: "opacity-0 transition-opacity duration-300 delay-[3350ms] starting:opacity-100 motion-reduce:transition-none",
  stateAfterAppears: "transition-opacity duration-300 delay-[3350ms] starting:opacity-0 motion-reduce:transition-none",
} as const;
