import { Button } from '../../beui/project-button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../ui/dialog';
import type { ArtifactEditorKind } from './artifactViewModel';

interface EditorUnavailableDialogProps {
  kind: ArtifactEditorKind | null;
  onClose: () => void;
}

export function EditorUnavailableDialog({ kind, onClose }: EditorUnavailableDialogProps) {
  const title = kind === 'scene' ? 'Scene Editor' : 'UI Editor';
  return (
    <Dialog open={kind !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md p-5">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {title} is not available yet. No project data was changed.
        </DialogDescription>
        <div className="mt-5 flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
