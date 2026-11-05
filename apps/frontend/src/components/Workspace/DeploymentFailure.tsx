import { CircleX } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { Button } from '../beui/project-button';
import { PresenceGate } from '../beui/registry/lib/presence-gate';

/** A publication result, separate from the editable publication form. */
export function DeploymentFailure({ projectName, message, labels, onBack, onFix, busy }: {
  projectName: string;
  message: string;
  labels: Record<string, string>;
  onBack: () => void;
  onFix?: () => void;
  busy: boolean;
}) {
  const reduced = useReducedMotion();
  return <motion.div initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
    transition={{ duration: reduced ? 0 : 0.28 }}>
    <PresenceGate>{({ gate }) => <div {...gate} className="flex min-h-[412px] flex-col px-7 pb-7 pt-[58px] text-center">
      <div className="flex flex-1 flex-col items-center">
        <div aria-hidden="true" className="mb-[22px] grid size-16 place-items-center rounded-full bg-destructive/10 text-destructive">
          <CircleX className="size-[29px] stroke-[1.5]" />
        </div>
        <h2 className="text-[23px] font-medium leading-[30px] tracking-[-0.025em]">{labels.deploymentFailed}</h2>
        <p className="type-callout mt-2 w-full break-words text-muted-foreground">{projectName}</p>
        <div role="alert" className="type-footnote mt-5 max-h-32 w-full overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--surface-3)] p-3 text-left text-muted-foreground">{message}</div>
      </div>
      <div className="mt-7 flex flex-col gap-2">
        <Button type="button" onClick={onBack} disabled={busy} className="h-10 w-full rounded-full">{labels.deploymentBackToEditor}</Button>
        {onFix ? <Button type="button" variant="ghost" onClick={onFix} disabled={busy} className="h-9 w-full rounded-full">{labels.fixBuildErrors}</Button> : null}
      </div>
    </div>}</PresenceGate>
  </motion.div>;
}
