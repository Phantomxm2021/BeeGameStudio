import { AnimatedNumber } from '@/components/beui/motion/animated-number';
import { Check, CloudUpload, Share } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from '../beui/project-button';
import { PresenceGate } from '../beui/registry/lib/presence-gate';

export function DeploymentProgress({ status, projectName, version, uploadProgress, copied, onShare, labels }: {
  status: 'queued' | 'building' | 'publishing' | 'succeeded';
  projectName: string;
  version: number;
  uploadProgress?: { uploadedBytes: number; totalBytes: number; phase: 'uploading' | 'verifying' };
  copied: boolean;
  onShare: () => void;
  labels: Record<string, string>;
}) {
  const reduced = useReducedMotion();
  const complete = status === 'succeeded';
  const progress = status === 'publishing' ? uploadProgress : undefined;
  const percent = progress?.phase === 'uploading' && progress.totalBytes > 0
    ? Math.max(0, Math.min(100, Math.floor(progress.uploadedBytes / progress.totalBytes * 100))) : undefined;
  const stage = status === 'building' ? labels.deploymentBuilding
    : status === 'publishing' ? progress?.phase === 'verifying' ? labels.deploymentVerifying
      : percent !== undefined ? labels.deploymentUploading.replace('{percent}', String(percent)) : labels.deploymentUploadVerify
      : labels.deploymentQueued;
  const ease = [0.22, 1, 0.36, 1] as const;
  const element = {
    hidden: { opacity: 0, y: reduced ? 0 : 7 },
    visible: { opacity: 1, y: 0, transition: { duration: reduced ? 0 : 0.32, ease } },
  };
  return <AnimatePresence mode="wait">
    <motion.div key={complete ? 'complete' : 'progress'}
      initial="hidden" animate="visible" exit={{ opacity: 0, y: reduced ? 0 : -5, transition: { duration: reduced ? 0 : 0.15 } }}
      variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: reduced ? 0 : 0.055 } } }}>
      <PresenceGate>{({ gate }) => <div {...gate} className="flex min-h-[412px] flex-col px-7 pb-7 pt-[58px] text-center">
        <div className="flex flex-1 flex-col items-center" aria-live="polite">
          <motion.div variants={element} aria-hidden="true" className="mb-[22px] grid size-16 shrink-0 place-items-center">
            {complete ? <motion.div initial={reduced ? false : { scale: 0.85 }} animate={{ scale: 1 }} transition={{ duration: 0.42, ease }}
              className="grid size-16 place-items-center rounded-full bg-[color-mix(in_srgb,var(--success)_14%,transparent)] text-[var(--success)]">
              <Check className="size-[29px] stroke-2" />
            </motion.div> : <div className="grid size-16 place-items-center rounded-[17px] bg-gradient-to-br from-foreground/[0.08] to-foreground/[0.03] shadow-sm ring-1 ring-inset ring-foreground/[0.04]">
              <motion.div animate={reduced ? undefined : { y: [1, -2, 1] }} transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}>
                <CloudUpload className="size-[30px] stroke-[1.5]" />
              </motion.div>
            </div>}
          </motion.div>
          <motion.h2 variants={element} className="text-[23px] font-medium leading-[30px] tracking-[-0.025em]">
            {complete ? labels.deploymentCompleteTitle : labels.deploymentPublishingTitle}
          </motion.h2>
          <motion.p variants={element} className="type-callout mt-2 w-full break-words text-muted-foreground">{projectName}</motion.p>
          {complete ? <motion.p variants={element} className="type-callout mt-5 text-muted-foreground">
            {labels.deploymentVersionLive.replace('{version}', String(version))}
          </motion.p> : <>
            <motion.div variants={element} className="mt-7 w-full max-w-[246px]">
              <div role="progressbar" aria-label={labels.deploymentProgress} aria-valuetext={stage} aria-valuemin={percent === undefined ? undefined : 0} aria-valuemax={percent === undefined ? undefined : 100} aria-valuenow={percent}
                className="relative h-1 overflow-hidden rounded-full bg-foreground/10">
                {percent !== undefined ? <motion.div key="upload-progress" className="absolute inset-y-0 left-0 rounded-full bg-foreground/60"
                  initial={false} animate={{ width: `${percent}%` }} transition={{ duration: reduced ? 0 : 0.3, ease }} /> : <motion.div key="stage-activity" className="absolute inset-y-0 left-0 w-[38%] rounded-full bg-foreground/60"
                  animate={reduced ? { x: '80%' } : { x: ['-110%', '365%'] }}
                  transition={{ duration: reduced ? 0 : 2.5, repeat: reduced ? 0 : Infinity, ease: [0.45, 0, 0.55, 1] }} />}
              </div>
              <div className="relative mt-3 h-5">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.p key={progress?.phase || status} initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: reduced ? 0 : -3 }} transition={{ duration: reduced ? 0 : 0.18, ease }}
                    className="type-footnote text-muted-foreground"><AnimatedNumber>{stage}</AnimatedNumber></motion.p>
                </AnimatePresence>
              </div>
            </motion.div>
            <motion.p variants={element} className="type-footnote mt-5 text-muted-foreground">{labels.deploymentBackground}</motion.p>
          </>}
        </div>
        {complete ? <motion.div variants={element} className="mt-7">
          <Button type="button" onClick={onShare} className="h-10 w-full gap-2 rounded-full px-5">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={copied ? 'copied' : 'share'} initial={reduced ? false : { opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduced ? 0 : -3 }} transition={{ duration: reduced ? 0 : 0.14 }}
                className="inline-flex items-center gap-2">
                {copied ? <Check aria-hidden="true" className="size-4" /> : <Share aria-hidden="true" className="size-4" />}
                {copied ? labels.deploymentCopied : labels.deploymentShare}
              </motion.span>
            </AnimatePresence>
          </Button>
        </motion.div> : <div className="h-[68px] shrink-0" aria-hidden="true" />}
      </div>}</PresenceGate>
    </motion.div>
  </AnimatePresence>;
}
