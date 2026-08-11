import type { Flow } from '../schema/types';
import { flowToGraph, type FlowGraph } from './flowGraph';

/**
 * Starter flows offered on an empty canvas.
 *
 * A blank grid tells a first-time user nothing about what a flow is for. These
 * are meant to be edited, not run as-is — each one is a shape people actually
 * want, with the wiring already correct so the first thing they see is a
 * working DAG rather than a validation error.
 *
 * Rules every template keeps:
 *  - only references inputs that are genuinely upstream, so it validates and
 *    runs without editing;
 *  - a human gate before anything that executes, so a template can never be
 *    the reason a command ran unreviewed;
 *  - positions on every node, so it opens laid out.
 */
export interface FlowTemplate {
  id: string;
  title: string;
  description: string;
  icon: string;
  build(name: string): Flow;
}

const COLUMN = 300;
const ROW = 220;

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    id: 'plan-implement-review',
    title: 'Plan → implement → review',
    description: 'Draft a plan, build it, then review the result before tests run.',
    icon: 'account_tree',
    build: (name) => ({
      version: 1,
      name,
      nodes: [
        {
          id: 'plan',
          type: 'agent',
          label: 'Draft plan',
          prompt: 'Write an implementation plan for {{task}}. List the files you would change.',
          output: 'plan_md',
          position: { x: 0, y: 0 },
        },
        {
          id: 'implement',
          type: 'agent',
          label: 'Implement',
          prompt: 'Implement this plan:\n\n{{plan.plan_md}}',
          output: 'summary',
          position: { x: COLUMN, y: 0 },
        },
        {
          id: 'review',
          type: 'agent',
          label: 'Review',
          prompt: 'Review the change just made. Summary of what was done:\n\n{{implement.summary}}',
          position: { x: COLUMN * 2, y: 0 },
        },
        {
          id: 'gate',
          type: 'human-gate',
          label: 'Run the tests?',
          message: 'Plan, implementation and review are done. Run the test suite?',
          position: { x: COLUMN * 3, y: 0 },
        },
        {
          id: 'test',
          type: 'shell',
          label: 'Test',
          run: 'npm test',
          position: { x: COLUMN * 4, y: 0 },
        },
      ],
      edges: [
        { from: 'plan', to: 'implement', port: 'plan_md' },
        { from: 'implement', to: 'review', port: 'summary' },
        { from: 'review', to: 'gate' },
        { from: 'gate', to: 'test' },
      ],
      variables: { task: 'describe the change here' },
    }),
  },
  {
    id: 'investigate-fix',
    title: 'Investigate → fix → verify',
    description: 'Reproduce a bug, fix it, and check the suite once you approve.',
    icon: 'bug_report',
    build: (name) => ({
      version: 1,
      name,
      nodes: [
        {
          id: 'investigate',
          type: 'agent',
          label: 'Investigate',
          prompt: 'Investigate this bug and explain the root cause: {{bug}}',
          output: 'diagnosis',
          position: { x: 0, y: 0 },
        },
        {
          id: 'fix',
          type: 'agent',
          label: 'Fix',
          prompt: 'Fix the cause described here, with a failing test first:\n\n{{investigate.diagnosis}}',
          output: 'summary',
          position: { x: COLUMN, y: 0 },
        },
        {
          id: 'gate',
          type: 'human-gate',
          label: 'Approve the fix',
          message: 'Review the fix, then approve to run the suite.',
          position: { x: COLUMN * 2, y: 0 },
        },
        {
          id: 'verify',
          type: 'shell',
          label: 'Verify',
          run: 'npm test',
          position: { x: COLUMN * 3, y: 0 },
        },
      ],
      edges: [
        { from: 'investigate', to: 'fix', port: 'diagnosis' },
        { from: 'fix', to: 'gate' },
        { from: 'gate', to: 'verify' },
      ],
      variables: { bug: 'describe the bug here' },
    }),
  },
  {
    id: 'parallel-review',
    title: 'Two reviews in parallel',
    description: 'Run a correctness pass and a security pass at once, then decide.',
    icon: 'call_split',
    build: (name) => ({
      version: 1,
      name,
      nodes: [
        {
          id: 'summarise',
          type: 'agent',
          label: 'Summarise the change',
          prompt: 'Summarise the current uncommitted change in {{scope}}.',
          output: 'summary',
          position: { x: 0, y: ROW / 2 },
        },
        {
          id: 'correctness',
          type: 'agent',
          label: 'Correctness review',
          prompt: 'Review for bugs and logic errors:\n\n{{summarise.summary}}',
          output: 'notes',
          position: { x: COLUMN, y: 0 },
        },
        {
          id: 'security',
          type: 'agent',
          label: 'Security review',
          prompt: 'Review for security problems:\n\n{{summarise.summary}}',
          output: 'notes',
          position: { x: COLUMN, y: ROW },
        },
        {
          id: 'decide',
          type: 'human-gate',
          label: 'Decide',
          message: 'Both reviews are in. Ship it?',
          position: { x: COLUMN * 2, y: ROW / 2 },
        },
      ],
      edges: [
        { from: 'summarise', to: 'correctness', port: 'summary' },
        { from: 'summarise', to: 'security', port: 'summary' },
        { from: 'correctness', to: 'decide' },
        { from: 'security', to: 'decide' },
      ],
      variables: { scope: 'the whole repo' },
    }),
  },
  {
    id: 'release-notes',
    title: 'Release notes from the log',
    description: 'Read the git log, draft notes, and hold them for your approval.',
    icon: 'campaign',
    build: (name) => ({
      version: 1,
      name,
      nodes: [
        {
          id: 'gate',
          type: 'human-gate',
          label: 'Read the log?',
          message: 'Read the recent git history to draft release notes?',
          position: { x: 0, y: 0 },
        },
        {
          id: 'log',
          type: 'shell',
          label: 'Recent commits',
          run: 'git log --oneline -30',
          output: 'log',
          position: { x: COLUMN, y: 0 },
        },
        {
          id: 'draft',
          type: 'agent',
          label: 'Draft notes',
          prompt: 'Write user-facing release notes from these commits:\n\n{{log.log}}',
          output: 'notes',
          position: { x: COLUMN * 2, y: 0 },
        },
        {
          id: 'approve',
          type: 'human-gate',
          label: 'Approve notes',
          message: 'Release notes are drafted. Approve them?',
          position: { x: COLUMN * 3, y: 0 },
        },
        // The point of the flow: approved notes end up in a file, not in a run
        // record. Deliberately after the gate, so nothing is written until a
        // person has read it.
        {
          id: 'save',
          type: 'write-file',
          label: 'Save the notes',
          path: 'RELEASE_NOTES.md',
          content: '{{draft.notes}}',
          position: { x: COLUMN * 4, y: 0 },
        },
      ],
      edges: [
        { from: 'gate', to: 'log' },
        { from: 'log', to: 'draft', port: 'log' },
        { from: 'draft', to: 'approve' },
        { from: 'approve', to: 'save' },
      ],
      variables: {},
    }),
  },
  {
    id: 'fan-out-review',
    title: 'Review every file in parallel',
    description: 'List the changed files, then run one sub-agent per file at once.',
    icon: 'hub',
    build: (name) => ({
      version: 1,
      name,
      nodes: [
        {
          id: 'gate',
          type: 'human-gate',
          label: 'List changed files?',
          message: 'Read the list of changed files to review?',
          position: { x: 0, y: 0 },
        },
        {
          id: 'files',
          type: 'shell',
          label: 'Changed files',
          run: 'git diff --name-only HEAD',
          output: 'list',
          position: { x: COLUMN, y: 0 },
        },
        {
          id: 'review',
          type: 'fan-out',
          label: 'Review each file',
          prompt: 'Review {{item}} for bugs and unclear naming. Be brief.',
          over: '{{files.list}}',
          concurrency: 4,
          output: 'reviews',
          position: { x: COLUMN * 2, y: 0 },
        },
        {
          id: 'summarise',
          type: 'agent',
          label: 'Summarise',
          prompt: 'Summarise these per-file reviews into one list of actions:\n\n{{review.reviews}}',
          position: { x: COLUMN * 3, y: 0 },
        },
      ],
      edges: [
        { from: 'gate', to: 'files' },
        { from: 'files', to: 'review', port: 'list' },
        { from: 'review', to: 'summarise', port: 'reviews' },
      ],
      variables: {},
    }),
  },
  {
    id: 'single-agent',
    title: 'One agent',
    description: 'Start from a single step and grow it.',
    icon: 'smart_toy',
    build: (name) => ({
      version: 1,
      name,
      nodes: [
        {
          id: 'agent',
          type: 'agent',
          label: 'Do the thing',
          prompt: '{{task}}',
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      variables: { task: 'describe the task here' },
    }),
  },
];

/** Turn a template into canvas nodes and edges, ready to drop in. */
export function applyTemplate(template: FlowTemplate, name: string): FlowGraph {
  return flowToGraph(template.build(name));
}
