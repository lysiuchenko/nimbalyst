// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../cli';

describe('parseCliArgs', () => {
  it('reads the run command and its flow file', () => {
    expect(parseCliArgs(['run', 'review.flow.json'])).toMatchObject({
      command: 'run',
      flowPath: 'review.flow.json',
    });
  });

  it('collects repeated --var flags', () => {
    const parsed = parseCliArgs(['run', 'f.flow.json', '--var', 'input=src/', '--var', 'depth=2']);

    expect(parsed.command === 'run' && parsed.variables).toEqual({ input: 'src/', depth: '2' });
  });

  it('keeps everything after the first = so a value can contain one', () => {
    const parsed = parseCliArgs(['run', 'f.flow.json', '--var', 'query=a=b']);

    expect(parsed.command === 'run' && parsed.variables).toEqual({ query: 'a=b' });
  });

  it('accepts --var name=value written as one argument', () => {
    const parsed = parseCliArgs(['run', 'f.flow.json', '--var=input=src/']);

    expect(parsed.command === 'run' && parsed.variables).toEqual({ input: 'src/' });
  });

  it('reads the compile command and its output path', () => {
    expect(parseCliArgs(['compile', 'f.flow.json', '--out', '.claude/commands/x.md'])).toMatchObject({
      command: 'compile',
      flowPath: 'f.flow.json',
      outPath: '.claude/commands/x.md',
    });
  });

  it('treats validate as its own command', () => {
    expect(parseCliArgs(['validate', 'f.flow.json'])).toMatchObject({
      command: 'validate',
      flowPath: 'f.flow.json',
    });
  });

  it('asks for help when given nothing', () => {
    expect(parseCliArgs([])).toMatchObject({ command: 'help' });
  });

  it.each([['--help'], ['-h']])('asks for help on %s', (flag) => {
    expect(parseCliArgs([flag])).toMatchObject({ command: 'help' });
  });

  it('rejects an unknown command rather than guessing', () => {
    expect(() => parseCliArgs(['deploy', 'f.flow.json'])).toThrow('unknown command "deploy"');
  });

  it('rejects a run with no flow file', () => {
    expect(() => parseCliArgs(['run'])).toThrow('run needs a .flow.json path');
  });

  it('rejects a --var that is not name=value', () => {
    expect(() => parseCliArgs(['run', 'f.flow.json', '--var', 'oops'])).toThrow(
      '--var expects name=value, got "oops"'
    );
  });

  it('defaults schedule to listing, which changes nothing', () => {
    expect(parseCliArgs(['schedule'])).toEqual({
      command: 'schedule',
      action: 'list',
      everyMinutes: 30,
    });
  });

  it('takes a wake interval for the installed agent', () => {
    expect(parseCliArgs(['schedule', 'install', '--every', '10'])).toMatchObject({
      action: 'install',
      everyMinutes: 10,
    });
  });

  it('refuses an interval that would spin', () => {
    expect(() => parseCliArgs(['schedule', 'install', '--every', '0'])).toThrow('positive');
  });

  it('refuses an action it does not have', () => {
    expect(() => parseCliArgs(['schedule', 'frobnicate'])).toThrow('unknown schedule action');
  });
});
