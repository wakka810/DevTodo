import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Handle, Position, ReactFlow } from '@xyflow/react'
import type { Edge, Node, NodeProps, ReactFlowInstance } from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import { ChevronDown, ChevronRight, Maximize, Minus, Plus } from 'lucide-react'
import { STATUS_LABELS } from '../domain/types'
import type { Task } from '../domain/types'
import type { BoardViewProps } from './BoardView'
import { indexTasks, visibleTree } from './view-model'
import type { TreeRow } from './view-model'
import '@xyflow/react/dist/style.css'
import './views.css'

type StructureNode = Node<{
  task: Task; contextOnly: boolean; hasChildren: boolean; expanded: boolean; filtering: boolean
  onSelect: (id: string) => void; onToggle: (id: string) => void
}, 'task'>

const NODE_WIDTH = 264
const NODE_HEIGHT = 152
const NARROW_QUERY = '(max-width: 767px)'
const subscribeWidth = (onChange: () => void) => {
  const query = window.matchMedia(NARROW_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
const readWidth = () => window.matchMedia(NARROW_QUERY).matches

function TaskNode({ data }: NodeProps<StructureNode>) {
  return (
    <div className={`structure-node${data.contextOnly ? ' structure-node--context' : ''}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} className="structure-handle" />
      <div className="structure-node-meta"><span>{STATUS_LABELS[data.task.status]}</span>{data.contextOnly ? <span>親タスク</span> : null}</div>
      <button type="button" className="structure-node-title nodrag nopan" title={data.task.title} onClick={() => data.onSelect(data.task.id)}>{data.task.title}</button>
      {data.hasChildren ? (
        <button
          type="button" className="structure-collapse nodrag nopan" aria-expanded={data.expanded} aria-controls="structure-graph"
          aria-label={`${data.task.title}の子タスクを${data.expanded ? '折りたたむ' : '展開'}`}
          disabled={data.filtering} title={data.filtering ? '検索中は一致するタスクまで展開します' : undefined}
          onClick={() => data.onToggle(data.task.id)}
        >{data.expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}{data.expanded ? '折りたたむ' : '展開する'}</button>
      ) : null}
      <Handle type="source" position={Position.Right} isConnectable={false} className="structure-handle" />
    </div>
  )
}

const nodeTypes = { task: TaskNode }

function arrange(rows: TreeRow[]) {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
  graph.setGraph({ rankdir: 'LR', ranksep: 64, nodesep: 24, marginx: 28, marginy: 28 })
  const ids = new Set(rows.map(row => row.task.id))
  for (const row of rows) graph.setNode(row.task.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  const edges: Edge[] = []
  for (const { task } of rows) {
    if (task.parentId && ids.has(task.parentId)) {
      graph.setEdge(task.parentId, task.id)
      edges.push({ id: `edge:${task.parentId}:${task.id}`, source: task.parentId, target: task.id, type: 'smoothstep', selectable: false, focusable: false })
    }
  }
  dagre.layout(graph)
  const positions = new Map(rows.map(({ task }) => {
    const { x, y } = graph.node(task.id)
    return [task.id, { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 }] as const
  }))
  return { positions, edges }
}

function Outline({ rows, onSelect, onToggle, filtering }: {
  rows: TreeRow[]; onSelect: (id: string) => void; onToggle: (id: string) => void; filtering: boolean
}) {
  const visibleIds = new Set(rows.map(row => row.task.id))
  const children = new Map<string | null, TreeRow[]>()
  for (const row of rows) {
    const parentId = row.task.parentId && visibleIds.has(row.task.parentId) ? row.task.parentId : null
    children.set(parentId, [...(children.get(parentId) ?? []), row])
  }
  function list(parentId: string | null) {
    const items = children.get(parentId) ?? []
    return <ul id={parentId ? `structure-children-${parentId}` : undefined}>
      {items.map(row => <li key={row.task.id}>
        <div className={`structure-outline-row${row.contextOnly ? ' structure-outline-row--context' : ''}`}>
          {row.hasChildren ? <button
            type="button" className="structure-outline-toggle" aria-expanded={row.expanded}
            aria-controls={row.expanded ? `structure-children-${row.task.id}` : undefined}
            aria-label={`${row.task.title}の子タスクを${row.expanded ? '折りたたむ' : '展開'}`}
            disabled={filtering} onClick={() => onToggle(row.task.id)}
          >{row.expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}</button> : <span className="structure-outline-spacer" />}
          <button type="button" className="structure-outline-title" onClick={() => onSelect(row.task.id)}>{row.task.title}<span>{STATUS_LABELS[row.task.status]}{row.contextOnly ? ' · 親タスク' : ''}</span></button>
        </div>
        {row.expanded ? list(row.task.id) : null}
      </li>)}
    </ul>
  }
  return <div className="structure-outline" aria-label="タスクの親子関係">{list(null)}</div>
}

export default function StructureView({ tasks, matchingIds, filtering, onSelect }: BoardViewProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())
  const [rootId, setRootId] = useState('')
  const [flow, setFlow] = useState<ReactFlowInstance<StructureNode> | null>(null)
  const narrow = useSyncExternalStore(subscribeWidth, readWidth, () => false)
  const index = useMemo(() => indexTasks(tasks), [tasks])
  const roots = index.children.get(null) ?? []
  const selectedRoot = roots.some(task => task.id === rootId) ? rootId : ''
  const rows = useMemo(() => visibleTree(tasks, { matchingIds, filtering, collapsedIds, rootId: selectedRoot }), [tasks, matchingIds, filtering, collapsedIds, selectedRoot])
  const layout = useMemo(() => arrange(rows), [rows])
  const toggle = useCallback((id: string) => setCollapsedIds(previous => {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }), [])
  const nodes = useMemo<StructureNode[]>(() => rows.map(row => ({
    id: row.task.id, type: 'task', position: layout.positions.get(row.task.id)!, width: NODE_WIDTH, height: NODE_HEIGHT,
    draggable: false, selectable: false, connectable: false, focusable: false,
    data: { ...row, filtering, onSelect, onToggle: toggle },
  })), [rows, layout, filtering, onSelect, toggle])

  useEffect(() => {
    if (!flow || narrow) return
    const frame = requestAnimationFrame(() => { void flow.fitView({ padding: 0.18, minZoom: 0.25, maxZoom: 1 }) })
    return () => cancelAnimationFrame(frame)
  }, [flow, layout, narrow])

  return (
    <section className="structure" aria-label="構造ビュー">
      <div className="structure-toolbar">
        <label className="structure-root-filter">表示する親タスク
          <select value={selectedRoot} onChange={event => setRootId(event.target.value)}>
            <option value="">すべて</option>
            {roots.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}
          </select>
        </label>
        <button type="button" className="structure-action" disabled={filtering || roots.length === 0} onClick={() => setCollapsedIds(new Set(tasks.filter(task => index.children.has(task.id)).map(task => task.id)))}>すべて折りたたむ</button>
        <button type="button" className="structure-action" disabled={filtering || collapsedIds.size === 0} onClick={() => setCollapsedIds(new Set())}>すべて展開</button>
        {!narrow ? <div className="structure-zoom">
          <button type="button" className="structure-action" aria-label="構造図を縮小" disabled={!flow || rows.length === 0} onClick={() => { void flow?.zoomOut() }}><Minus size={16} aria-hidden="true" /></button>
          <button type="button" className="structure-action" aria-label="構造図を拡大" disabled={!flow || rows.length === 0} onClick={() => { void flow?.zoomIn() }}><Plus size={16} aria-hidden="true" /></button>
          <button type="button" className="structure-action" disabled={!flow || rows.length === 0} onClick={() => { void flow?.fitView({ padding: 0.18, minZoom: 0.1, maxZoom: 1 }) }}><Maximize size={15} aria-hidden="true" />全体を表示</button>
        </div> : null}
      </div>
      {rows.length === 0 ? <div className="structure-empty">{tasks.length === 0 ? 'タスクがありません' : '一致するタスクがありません'}</div>
        : narrow ? <Outline rows={rows} onSelect={onSelect} onToggle={toggle} filtering={filtering} />
          : <div id="structure-graph" className="structure-canvas"><ReactFlow<StructureNode>
              nodes={nodes} edges={layout.edges} nodeTypes={nodeTypes} onInit={instance => setFlow(instance)}
              nodesDraggable={false} nodesConnectable={false} nodesFocusable={false} edgesFocusable={false}
              elementsSelectable={false} edgesReconnectable={false} deleteKeyCode={null} selectionKeyCode={null}
              connectOnClick={false} zoomOnDoubleClick={false} minZoom={0.1} maxZoom={1.5}
              fitView fitViewOptions={{ padding: 0.18, minZoom: 0.25, maxZoom: 1 }}
              aria-label="タスクの親子関係"
            /></div>}
    </section>
  )
}
