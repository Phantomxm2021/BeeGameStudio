import { useEffect, useMemo, useState } from 'react';
import {
  beeGameAdapter,
  type BeeGameUiContentDocument,
  type BeeGameUiContentNode,
} from '../../services/beeGameAdapter';
import './UiEditorOverlay.css';

interface UiEditorOverlayProps {
  projectId: string;
  onClose: () => void;
}

type UiSnapshot = {
  path: string;
  revision: string;
  document: BeeGameUiContentDocument;
};

const UI_IMAGE = /\.(?:png|jpe?g|webp|gif|avif|bmp|svg)$/i;

export function UiEditorOverlay({ projectId, onClose }: UiEditorOverlayProps) {
  const [documents, setDocuments] = useState<UiSnapshot[]>([]);
  const [current, setCurrent] = useState<UiSnapshot>();
  const [selectedId, setSelectedId] = useState('');
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('Loading project UI…');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    const objectUrls: string[] = [];
    setDocuments([]);
    setCurrent(undefined);
    setSelectedId('');
    setAssetUrls({});
    setMessage('Loading project UI…');
    void Promise.all([
      beeGameAdapter.getProjectGameContent(projectId),
      beeGameAdapter.getProjectAssets(projectId),
    ]).then(async ([snapshot, manifest]) => {
      if (!active) return;
      if ((snapshot.state !== 'ready' && snapshot.state !== 'draft') || !snapshot.documents) {
        setMessage(`UI content is not available yet (${snapshot.state.replaceAll('_', ' ')}).`);
        return;
      }
      const uiDocuments = snapshot.documents.flatMap(item => {
        const document = item.document as Partial<BeeGameUiContentDocument>;
        return document.kind === 'ui-screen' || document.kind === 'ui-hud' || document.kind === 'ui-flow'
          ? [{ ...item, document: item.document as BeeGameUiContentDocument }]
          : [];
      });
      if (!uiDocuments.length) {
        setMessage('The content package has no UI documents.');
        return;
      }
      const referenced = new Set(uiDocuments.flatMap(item => item.document.assetRefs));
      const loaded = await Promise.all(manifest.resources
        .filter(resource => resource.status === 'verified' && referenced.has(resource.id))
        .map(async resource => {
          const path = resource.file_paths.find(file => UI_IMAGE.test(file));
          if (!path) return undefined;
          try {
            const blob = await beeGameAdapter.loadProjectAssetFile(projectId, resource.id, path);
            const url = URL.createObjectURL(blob);
            if (!active) {
              URL.revokeObjectURL(url);
              return undefined;
            }
            objectUrls.push(url);
            return [resource.id, url] as const;
          } catch {
            return undefined;
          }
        }));
      if (!active) return;
      setDocuments(uiDocuments);
      setCurrent(structuredClone(uiDocuments[0]));
      setSelectedId(uiDocuments[0].document.data.rootId);
      setAssetUrls(Object.fromEntries(loaded.filter(item => item !== undefined)));
      setMessage('');
    }).catch(error => {
      if (active) setMessage(error instanceof Error ? error.message : String(error));
    });
    return () => {
      active = false;
      objectUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [projectId]);

  const selected = current?.document.data.nodes.find(node => node.id === selectedId);
  const children = useMemo(() => childIds(current?.document.data.nodes ?? []), [current]);

  const chooseDocument = (path: string) => {
    const drafts = documents.map(document => current && document.path === current.path ? current : document);
    const next = drafts.find(document => document.path === path);
    if (!next) return;
    setDocuments(drafts);
    const clone = structuredClone(next);
    setCurrent(clone);
    setSelectedId(clone.document.data.rootId);
    setMessage('');
  };

  const updateSelected = (update: (node: BeeGameUiContentNode) => void) => {
    setCurrent(value => {
      if (!value) return value;
      const next = structuredClone(value);
      const node = next.document.data.nodes.find(item => item.id === selectedId);
      if (node) update(node);
      return next;
    });
  };

  const updateLayout = (field: 'position' | 'size', index: number, value: number) => {
    updateSelected(node => {
      const layout = node.layout ?? {};
      const pair = [...(layout[field] ?? (field === 'size' ? [160, 48] : [0, 0]))] as [number, number];
      pair[index] = value;
      node.layout = { ...layout, [field]: pair };
    });
  };

  const updateScale = (index: number, value: number) => {
    updateSelected(node => {
      const layout = node.layout ?? {};
      const scale = [...(layout.scale ?? [1, 1])] as [number, number];
      scale[index] = value;
      node.layout = { ...layout, scale };
    });
  };

  const save = async () => {
    if (!current || saving) return;
    setSaving(true);
    setMessage('Saving…');
    try {
      const saved = await beeGameAdapter.saveProjectGameContentDocument(projectId, {
        path: current.path,
        expectedRevision: current.revision,
        document: current.document,
      });
      const next = { path: saved.path, revision: saved.revision, document: saved.document };
      setCurrent(next);
      setDocuments(value => value.map(item => item.path === next.path ? next : item));
      setMessage('Saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ui-editor-overlay" role="dialog" aria-modal="true" aria-label="UI Editor">
      <header className="ui-editor-toolbar">
        <strong>UI Editor</strong>
        <select aria-label="UI document" value={current?.path ?? ''} onChange={event => chooseDocument(event.target.value)} disabled={!documents.length}>
          {documents.map(document => <option key={document.path} value={document.path}>{document.document.id}</option>)}
        </select>
        <span className="ui-editor-message">{message}</span>
        <button type="button" onClick={() => void save()} disabled={!current || saving}>Save</button>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      <main className="ui-editor-main">
        <aside className="ui-editor-tree" aria-label="UI hierarchy">
          {current ? current.document.data.nodes.map(node => (
            <button key={node.id} type="button" className={node.id === selectedId ? 'selected' : ''} onClick={() => setSelectedId(node.id)}>
              <span>{node.name ?? node.id}</span><small>{node.role}</small>
            </button>
          )) : null}
        </aside>
        <section className="ui-editor-stage-wrap">
          <div className="ui-editor-stage" aria-label="UI preview">
            {current ? renderUiNode(current.document.data.rootId, current.document.data.nodes, children, assetUrls, selectedId, setSelectedId, true) : null}
          </div>
        </section>
        <aside className="ui-editor-inspector" aria-label="UI inspector">
          {selected ? <>
            <label>Name<input value={selected.name ?? ''} onChange={event => updateSelected(node => { node.name = event.target.value; })} /></label>
            <label>Text<input value={selected.text ?? ''} onChange={event => updateSelected(node => { node.text = event.target.value; })} /></label>
            <label>Anchor<input value={selected.layout?.anchor ?? ''} onChange={event => updateSelected(node => { node.layout = { ...node.layout, anchor: event.target.value }; })} /></label>
            <div className="ui-editor-pair"><span>Position</span>{[0, 1].map(index => <input key={index} aria-label={`Position ${index === 0 ? 'X' : 'Y'}`} type="number" value={selected.layout?.position?.[index] ?? 0} onChange={event => updateLayout('position', index, Number(event.target.value))} />)}</div>
            <div className="ui-editor-pair"><span>Size</span>{[0, 1].map(index => <input key={index} aria-label={`Size ${index === 0 ? 'X' : 'Y'}`} type="number" min="0" value={selected.layout?.size?.[index] ?? (index === 0 ? 160 : 48)} onChange={event => updateLayout('size', index, Math.max(0, Number(event.target.value)))} />)}</div>
            <div className="ui-editor-pair"><span>Scale</span>{[0, 1].map(index => <input key={index} aria-label={`Scale ${index === 0 ? 'X' : 'Y'}`} type="number" step="0.1" value={selected.layout?.scale?.[index] ?? 1} onChange={event => updateScale(index, Number(event.target.value))} />)}</div>
            <p>Role: {selected.role}</p>
            <p>Asset: {selected.assetRef ?? 'None'}</p>
          </> : <p>Select a UI node.</p>}
        </aside>
      </main>
    </div>
  );
}

function childIds(nodes: BeeGameUiContentNode[]): Map<string, string[]> {
  const output = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    output.set(node.parentId, [...(output.get(node.parentId) ?? []), node.id]);
  }
  return output;
}

function renderUiNode(
  id: string,
  nodes: BeeGameUiContentNode[],
  children: Map<string, string[]>,
  assetUrls: Record<string, string>,
  selectedId: string,
  select: (id: string) => void,
  root = false,
): React.ReactNode {
  const node = nodes.find(item => item.id === id);
  if (!node) return null;
  const style = uiNodeStyle(node, root);
  const image = node.assetRef ? assetUrls[node.assetRef] : undefined;
  return <div
    key={node.id}
    className={`ui-editor-node${selectedId === node.id ? ' selected' : ''}`}
    style={style}
    onPointerDown={event => { event.stopPropagation(); select(node.id); }}
    data-role={node.role}
  >
    {image ? <img src={image} alt="" draggable={false} /> : null}
    {node.text ? <span>{node.text}</span> : null}
    {(children.get(node.id) ?? []).map(child => renderUiNode(child, nodes, children, assetUrls, selectedId, select))}
  </div>;
}

function uiNodeStyle(node: BeeGameUiContentNode, root: boolean): React.CSSProperties {
  if (root) return { position: 'absolute', inset: 0 };
  const [x, y] = node.layout?.position ?? [0, 0];
  const [width, height] = node.layout?.size ?? [160, 48];
  const anchor = node.layout?.anchor ?? 'top-left';
  const [vertical, horizontal] = anchor === 'center' ? ['center', 'center'] : anchor.split('-');
  const [scaleX, scaleY] = node.layout?.scale ?? [1, 1];
  const style = node.style ?? {};
  const output: React.CSSProperties = {
    position: 'absolute', width, height,
    color: typeof style.color === 'string' ? style.color : undefined,
    background: typeof style.background === 'string' ? style.background : undefined,
    transform: `rotate(${node.layout?.rotation ?? 0}rad) scale(${scaleX}, ${scaleY})`,
  };
  if (horizontal === 'right') output.right = -x; else if (horizontal === 'center') output.left = `calc(50% + ${x}px)`; else output.left = x;
  if (vertical === 'bottom') output.bottom = -y; else if (vertical === 'center') output.top = `calc(50% + ${y}px)`; else output.top = y;
  output.translate = `${horizontal === 'center' ? '-50%' : '0'} ${vertical === 'center' ? '-50%' : '0'}`;
  return output;
}
