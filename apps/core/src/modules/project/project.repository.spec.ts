import { describe, expect, it } from 'vitest';
import { InMemoryProjectRepository } from './project.repository';

describe('InMemoryProjectRepository.createTask', () => {
  it('creates a task with a_faire defaults and zero progress', async () => {
    // Arrange
    const repo = new InMemoryProjectRepository();

    // Act
    const task = await repo.createTask({
      projectId: 'proj-1',
      label: 'Terrassement',
    });

    // Assert
    expect(task.id).toBeTruthy();
    expect(task.status).toBe('a_faire');
    expect(task.progressPct).toBe(0);
    expect(task.orderIndex).toBe(0);
    expect(task.projectId).toBe('proj-1');
  });

  it('forces progress to 100 when created with status termine', async () => {
    // Arrange
    const repo = new InMemoryProjectRepository();

    // Act
    const task = await repo.createTask({
      projectId: 'proj-1',
      label: 'Réception',
      status: 'termine',
      progressPct: 30,
    });

    // Assert — normalizeTaskPatch overrides the supplied 30.
    expect(task.status).toBe('termine');
    expect(task.progressPct).toBe(100);
  });
});

describe('InMemoryProjectRepository.listTasksByProject', () => {
  it('returns only the project tasks, ordered by orderIndex', async () => {
    // Arrange
    const repo = new InMemoryProjectRepository();
    await repo.createTask({ projectId: 'proj-1', label: 'Second', orderIndex: 2 });
    await repo.createTask({ projectId: 'proj-1', label: 'First', orderIndex: 1 });
    await repo.createTask({ projectId: 'proj-2', label: 'Other', orderIndex: 1 });

    // Act
    const list = await repo.listTasksByProject('proj-1');

    // Assert
    expect(list).toHaveLength(2);
    expect(list.map((t) => t.label)).toEqual(['First', 'Second']);
  });
});

describe('InMemoryProjectRepository.findTaskById', () => {
  it('returns the task when it exists', async () => {
    // Arrange
    const repo = new InMemoryProjectRepository();
    const created = await repo.createTask({
      projectId: 'proj-1',
      label: 'Terrassement',
    });

    // Act
    const found = await repo.findTaskById(created.id);

    // Assert
    expect(found?.id).toBe(created.id);
    expect(found?.projectId).toBe('proj-1');
  });

  it('returns null for an unknown task id', async () => {
    // Arrange
    const repo = new InMemoryProjectRepository();

    // Act
    const found = await repo.findTaskById('does-not-exist');

    // Assert
    expect(found).toBeNull();
  });

  it('exposes projectId so callers can enforce ownership scope', async () => {
    // Arrange — two tasks under two different projects.
    const repo = new InMemoryProjectRepository();
    const own = await repo.createTask({ projectId: 'proj-1', label: 'Mine' });
    const foreign = await repo.createTask({
      projectId: 'proj-2',
      label: 'Theirs',
    });

    // Act
    const foundForeign = await repo.findTaskById(foreign.id);

    // Assert — a proj-1 caller can detect the task belongs elsewhere.
    expect(foundForeign?.projectId).toBe('proj-2');
    expect(foundForeign?.projectId).not.toBe(own.projectId);
  });
});

describe('InMemoryProjectRepository.updateTask', () => {
  it('patches progress and status while keeping the label', async () => {
    // Arrange
    const repo = new InMemoryProjectRepository();
    const task = await repo.createTask({
      projectId: 'proj-1',
      label: 'Gros œuvre',
    });

    // Act
    const updated = await repo.updateTask(task.id, {
      progressPct: 45,
      status: 'en_cours',
    });

    // Assert
    expect(updated?.progressPct).toBe(45);
    expect(updated?.status).toBe('en_cours');
    expect(updated?.label).toBe('Gros œuvre');
  });

  it('forces progress to 100 when patched to termine', async () => {
    // Arrange
    const repo = new InMemoryProjectRepository();
    const task = await repo.createTask({
      projectId: 'proj-1',
      label: 'Finitions',
      status: 'en_cours',
      progressPct: 80,
    });

    // Act
    const updated = await repo.updateTask(task.id, { status: 'termine' });

    // Assert
    expect(updated?.progressPct).toBe(100);
  });

  it('returns null for an unknown task id', async () => {
    // Arrange
    const repo = new InMemoryProjectRepository();

    // Act
    const updated = await repo.updateTask('does-not-exist', { progressPct: 10 });

    // Assert
    expect(updated).toBeNull();
  });
});
