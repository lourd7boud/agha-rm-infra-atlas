import { describe, expect, it } from 'vitest';
import { InMemoryPeopleRepository } from './people.repository';

describe('InMemoryPeopleRepository.createAssignment', () => {
  it('stores the pay basis on the assignment', async () => {
    // Arrange
    const repo = new InMemoryPeopleRepository();
    const employee = await repo.createEmployee({
      fullName: 'Mohamed Alami',
      metier: 'maçon',
    });

    // Act
    const assignment = await repo.createAssignment(
      employee.id,
      'proj-1',
      new Date('2026-06-01'),
      { rateType: 'jour', rateAmountMad: 350 },
    );

    // Assert
    expect(assignment.rateType).toBe('jour');
    expect(assignment.rateAmountMad).toBe(350);
  });

  it('leaves the rate undefined when none is supplied', async () => {
    // Arrange
    const repo = new InMemoryPeopleRepository();
    const employee = await repo.createEmployee({
      fullName: 'Said Ouali',
      metier: 'manœuvre',
    });

    // Act
    const assignment = await repo.createAssignment(
      employee.id,
      'proj-1',
      new Date('2026-06-01'),
    );

    // Assert
    expect(assignment.rateType).toBeUndefined();
    expect(assignment.rateAmountMad).toBeUndefined();
  });
});

describe('InMemoryPeopleRepository.upsertWorkDay', () => {
  it('inserts then replaces idempotently on the same (assignment, date)', async () => {
    // Arrange
    const repo = new InMemoryPeopleRepository();
    const employee = await repo.createEmployee({
      fullName: 'Youssef Bennani',
      metier: 'chef de chantier',
    });
    const assignment = await repo.createAssignment(
      employee.id,
      'proj-1',
      new Date('2026-06-01'),
      { rateType: 'jour', rateAmountMad: 400 },
    );
    const workDate = new Date('2026-06-21');

    // Act — first log inserts a full day; re-logging the same day replaces it.
    const first = await repo.upsertWorkDay({
      assignmentId: assignment.id,
      workDate,
      daysWorked: 1,
    });
    const second = await repo.upsertWorkDay({
      assignmentId: assignment.id,
      workDate,
      daysWorked: 0.5,
      notes: 'demi-journée',
    });

    // Assert — no duplicate day; the corrected half-day + notes are kept.
    expect(first).toBe('inserted');
    expect(second).toBe('updated');
    const days = await repo.listWorkDays(assignment.id);
    expect(days).toHaveLength(1);
    expect(days[0]?.daysWorked).toBe(0.5);
    expect(days[0]?.notes).toBe('demi-journée');
  });
});

describe('InMemoryPeopleRepository.listTeamByProject', () => {
  it('joins each assignment to its worker name + métier in one pass', async () => {
    // Arrange — two workers on proj-1, one on proj-2 that must not leak in.
    const repo = new InMemoryPeopleRepository();
    const macon = await repo.createEmployee({
      fullName: 'Mohamed Alami',
      metier: 'maçon',
    });
    const chef = await repo.createEmployee({
      fullName: 'Youssef Bennani',
      metier: 'chef de chantier',
    });
    const other = await repo.createEmployee({
      fullName: 'Karim Idrissi',
      metier: 'plombier',
    });
    await repo.createAssignment(macon.id, 'proj-1', new Date('2026-06-01'));
    await repo.createAssignment(chef.id, 'proj-1', new Date('2026-06-02'));
    await repo.createAssignment(other.id, 'proj-2', new Date('2026-06-01'));

    // Act
    const team = await repo.listTeamByProject('proj-1');

    // Assert — proj-1 only, names resolved, no employee leakage.
    expect(team).toHaveLength(2);
    const maconMember = team.find((m) => m.employeeId === macon.id);
    expect(maconMember?.fullName).toBe('Mohamed Alami');
    expect(maconMember?.metier).toBe('maçon');
    expect(team.some((m) => m.employeeId === other.id)).toBe(false);
  });

  it('drops an assignment whose employee no longer resolves', async () => {
    // Arrange — an assignment pointing at a non-existent employee id.
    const repo = new InMemoryPeopleRepository();
    await repo.createAssignment('ghost', 'proj-1', new Date('2026-06-01'));

    // Act
    const team = await repo.listTeamByProject('proj-1');

    // Assert — same skip behaviour the old per-row loop had.
    expect(team).toHaveLength(0);
  });
});

describe('InMemoryPeopleRepository.projectLabor', () => {
  it('folds pointage and rates into per-worker dues + project totals', async () => {
    // Arrange — two workers on proj-1, one (jour) and one (mois), plus a worker
    // on another project that must NOT leak into proj-1's rollup.
    const repo = new InMemoryPeopleRepository();
    const macon = await repo.createEmployee({
      fullName: 'Mohamed Alami',
      metier: 'maçon',
    });
    const chef = await repo.createEmployee({
      fullName: 'Youssef Bennani',
      metier: 'chef de chantier',
    });
    const other = await repo.createEmployee({
      fullName: 'Karim Idrissi',
      metier: 'plombier',
    });

    const maconAssign = await repo.createAssignment(
      macon.id,
      'proj-1',
      new Date('2026-06-01'),
      { rateType: 'jour', rateAmountMad: 350 },
    );
    const chefAssign = await repo.createAssignment(
      chef.id,
      'proj-1',
      new Date('2026-06-01'),
      { rateType: 'mois', rateAmountMad: 7800 },
    );
    const otherAssign = await repo.createAssignment(
      other.id,
      'proj-2',
      new Date('2026-06-01'),
      { rateType: 'jour', rateAmountMad: 300 },
    );

    // maçon: 20 days @350 = 7000 ; chef: 26 days @(7800/26=300) = 7800.
    for (let day = 1; day <= 20; day++) {
      await repo.upsertWorkDay({
        assignmentId: maconAssign.id,
        workDate: new Date(2026, 5, day),
        daysWorked: 1,
      });
    }
    for (let day = 1; day <= 26; day++) {
      await repo.upsertWorkDay({
        assignmentId: chefAssign.id,
        workDate: new Date(2026, 5, day),
        daysWorked: 1,
      });
    }
    await repo.upsertWorkDay({
      assignmentId: otherAssign.id,
      workDate: new Date('2026-06-21'),
      daysWorked: 1,
    });

    // Act
    const labor = await repo.projectLabor('proj-1');

    // Assert — proj-1 only: 46 days, 14 800 MAD dues across two lines.
    expect(labor.lines).toHaveLength(2);
    expect(labor.totalDays).toBe(46);
    expect(labor.totalDuesMad).toBe(14_800);
    const maconLine = labor.lines.find((l) => l.employeeId === macon.id);
    expect(maconLine?.duesMad).toBe(7000);
    expect(maconLine?.fullName).toBe('Mohamed Alami');
    const chefLine = labor.lines.find((l) => l.employeeId === chef.id);
    expect(chefLine?.duesMad).toBe(7800);
  });

  it('lists a rate-less assignment with 0 dues, never dropping it', async () => {
    // Arrange
    const repo = new InMemoryPeopleRepository();
    const worker = await repo.createEmployee({
      fullName: 'Hassan Tazi',
      metier: 'manœuvre',
    });
    const assignment = await repo.createAssignment(
      worker.id,
      'proj-3',
      new Date('2026-06-01'),
    );
    await repo.upsertWorkDay({
      assignmentId: assignment.id,
      workDate: new Date('2026-06-21'),
      daysWorked: 1,
    });

    // Act
    const labor = await repo.projectLabor('proj-3');

    // Assert — visible with days counted but 0 dues until a rate is set.
    expect(labor.lines).toHaveLength(1);
    expect(labor.lines[0]?.totalDays).toBe(1);
    expect(labor.lines[0]?.duesMad).toBe(0);
    expect(labor.totalDuesMad).toBe(0);
  });
});
