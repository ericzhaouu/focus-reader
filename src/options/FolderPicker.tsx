import { useState } from 'react';
import type { FolderNode } from '../lib/types';

interface Props {
  nodes: FolderNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function Row({
  node,
  depth,
  selectedId,
  expanded,
  toggle,
  onSelect,
}: {
  node: FolderNode;
  depth: number;
  selectedId: string | null;
  expanded: Set<string>;
  toggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  return (
    <>
      <button
        type="button"
        className={`folder-row${selectedId === node.id ? ' folder-row--selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => onSelect(node.id)}
      >
        <span
          className="folder-row__caret"
          onClick={(event) => {
            if (!hasChildren) return;
            event.stopPropagation();
            toggle(node.id);
          }}
        >
          {hasChildren ? (isOpen ? '▼' : '▶') : ''}
        </span>
        <span>{node.title}</span>
      </button>
      {hasChildren &&
        isOpen &&
        node.children.map((child) => (
          <Row
            key={child.id}
            node={child}
            depth={depth + 1}
            selectedId={selectedId}
            expanded={expanded}
            toggle={toggle}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}

export default function FolderPicker({ nodes, selectedId, onSelect }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(nodes.map((n) => n.id)));

  const toggle = (id: string): void => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (nodes.length === 0) {
    return <div className="folder-tree muted">还没有任何书签文件夹。</div>;
  }

  return (
    <div className="folder-tree">
      {nodes.map((node) => (
        <Row
          key={node.id}
          node={node}
          depth={0}
          selectedId={selectedId}
          expanded={expanded}
          toggle={toggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
