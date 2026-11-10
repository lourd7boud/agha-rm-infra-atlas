import { describe, expect, test } from 'vitest';
import { buildTemplateLine, parseMetreClipboard, readMetreNumber, templatesForUnit } from './metre-entry';
import { computeLignePartielClient } from './btp-shared';

describe('metre clipboard', () => {
  test('recognizes reordered French headers and skips an exported calculated partial', () => {
    const result = parseMetreClipboard('Désignation\tProfondeur\tLongueur\tNb semblables\tLargeur\tPartiel\nSemelle S1\t0,5\t3\t2\t2\t6,00', 'M³');
    expect(result.errors).toEqual([]);
    expect(result.rows[0].errors).toEqual([]);
    expect(result.rows[0].line).toMatchObject({ designation: 'Semelle S1', profondeur: 0.5, longueur: 3, nombreSemblables: 2, largeur: 2 });
    expect(result.rows[0].line.partiel).toBeUndefined();
    expect(computeLignePartielClient('M³', { id: 'new', ...result.rows[0].line })).toBe(6);
  });
  test('reads positional rows, quoted delimiters and multiline descriptions', () => {
    const result = parseMetreClipboard('"Semelle; S1\nzone A";2;3;2;0,5\nRadier;1;4;4;0,2', 'M³');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].line.designation).toBe('Semelle; S1\nzone A');
    expect(result.rows[1].line.profondeur).toBe(0.2);
  });
  test('does not discard the first measurement when its designation is a header word', () => {
    expect(parseMetreClipboard('Longueur\t2\t3\t2\t0,5', 'M³').rows).toHaveLength(1);
  });
  test('preserves signs and rejects formulas, missing dimensions and mixed units', () => {
    const result = parseMetreClipboard('Désignation\tNombre\tNombre d’éléments\tLongueur\tØ (mm)\tUnité\nPoteaux\t4\t-2\t3\t12\tKG\nErreur\t=2+2\t1\t\t12\tT', 'KG');
    expect(result.rows[0].line.nombreElements).toBe(-2);
    expect(result.rows[0].errors).toEqual([]);
    expect(result.rows[1].errors.join(' ')).toMatch(/Nombre/);
    expect(result.rows[1].errors.join(' ')).toMatch(/Longueur/);
    expect(result.rows[1].errors.join(' ')).toMatch(/T.*KG/);
  });
  test('allows explicit column mapping and rejects duplicate numeric destinations', () => {
    const result = parseMetreClipboard('S1\t3\t2\t0,5\t2', 'M³', ['designation', 'longueur', 'largeur', 'profondeur', 'nombreSemblables']);
    expect(result.rows[0].line.longueur).toBe(3);
    expect(parseMetreClipboard('S1\t3\t2', 'M³', ['designation', 'longueur', 'longueur']).errors.join(' ')).toMatch(/plusieurs/);
  });
  test('rejects truncated rows, unmatched quotes, excess data and unsupported steel diameters', () => {
    expect(parseMetreClipboard('S1\t1\t2\t3\t0,5\textra', 'M³').errors.length).toBeGreaterThan(0);
    expect(parseMetreClipboard('"unclosed\t2\t3', 'M³').errors.length).toBeGreaterThan(0);
    expect(parseMetreClipboard(Array.from({ length: 501 }, () => 'S1\t1\t2\t3\t0,5').join('\n'), 'M³').errors.length).toBeGreaterThan(0);
    expect(parseMetreClipboard('Acier\t4\t2\t3\t13', 'KG').rows[0].errors.join(' ')).toMatch(/diamètre/i);
  });
  test('parses unambiguous locale numbers without evaluating expressions or units', () => {
    expect(readMetreNumber('1 234,5')).toBe(1234.5);
    expect(readMetreNumber('1.234,50')).toBe(1234.5);
    expect(readMetreNumber('-0,25')).toBe(-0.25);
    expect(readMetreNumber('1,2,3')).toBeUndefined();
    expect(readMetreNumber('20 cm')).toBeUndefined();
    expect(readMetreNumber('=2*3')).toBeUndefined();
  });
  test('handles leading blank lines and delimiters inside quoted descriptions', () => {
    expect(parseMetreClipboard('\n\nS1\t2\t3\t2\t0,5', 'M³').rows[0].errors).toEqual([]);
    expect(parseMetreClipboard('"S1\tzone A";2;3;2;0,5', 'M³').rows[0].errors).toEqual([]);
  });
  test('rejects numeric overflow even when each individual dimension is finite', () => {
    const huge = '1' + '0'.repeat(200);
    expect(parseMetreClipboard(`S1\t1\t${huge}\t${huge}\t1`, 'M³').rows[0].errors.join(' ')).toMatch(/résultat/i);
  });
  test('does not bypass source-unit checks with aliases, ignored columns or centimeter headers', () => {
    expect(parseMetreClipboard('Désignation\tNombre\tNombre d’éléments\tLongueur\tØ (mm)\tUnité de mesure\nP1\t4\t8\t3\t12\tT', 'KG').rows[0].errors.join(' ')).toMatch(/T.*KG/);
    expect(parseMetreClipboard('S1\t1\t2\t3\t0,5\tM²', 'M³', ['designation', 'nombreSemblables', 'longueur', 'largeur', 'profondeur', 'ignore']).rows[0].errors.join(' ')).toMatch(/M².*M³/);
    expect(parseMetreClipboard('Désignation\tNb\tLongueur (cm)\tLargeur\tProfondeur\nS1\t1\t200\t3\t0,5', 'M³', ['designation', 'nombreSemblables', 'longueur', 'largeur', 'profondeur']).errors.join(' ')).toMatch(/mètres/);
  });
  test('requires explicit mapping of an unknown count header instead of silently assuming one repetition', () => {
    const raw = 'Désignation\tNbre\tLongueur\tLargeur\tProfondeur\nS1\t8\t2\t2\t0,5';
    expect(parseMetreClipboard(raw, 'M³').errors.join(' ')).toMatch(/associer/);
    const mapped = parseMetreClipboard(raw, 'M³', ['designation', 'nombreSemblables', 'longueur', 'largeur', 'profondeur']);
    expect(mapped.errors).toEqual([]);
    expect(computeLignePartielClient('M³', { id: 'new', ...mapped.rows[0].line })).toBe(16);
  });
});

describe('work templates', () => {
  test('offers only templates suitable for the contract unit', () => {
    expect(templatesForUnit('M³').map((template) => template.id)).toContain('semelle');
    expect(templatesForUnit('KG').map((template) => template.id)).toEqual(['armatures']);
  });
  test('builds an explicit repeated volume and a steel deduction in tonnes', () => {
    const volume = buildTemplateLine('M³', 'semelle', { designation: 'S1', nombreSemblables: 8, longueur: 2, largeur: 2, profondeur: 0.5 });
    expect(volume.errors).toEqual([]);
    expect(computeLignePartielClient('M³', { id: 'v', ...volume.line })).toBe(16);
    const steel = buildTemplateLine('T', 'armatures', { designation: 'P1', nombre: 4, nombreElements: 8, longueur: 3, diametre: 12 }, true);
    expect(steel.errors).toEqual([]);
    expect(computeLignePartielClient('T', { id: 's', ...steel.line })).toBeCloseTo(-0.085248);
    expect(buildTemplateLine('KG', 'semelle', { longueur: 2 }).errors.length).toBeGreaterThan(0);
  });
  test('keeps a manually signed repetition when the deduction checkbox is not selected', () => {
    const result = buildTemplateLine('M³', 'semelle', { nombreSemblables: -8, longueur: 2, largeur: 2, profondeur: 0.5 });
    expect(computeLignePartielClient('M³', { id: 'v', ...result.line })).toBe(-16);
  });
});
