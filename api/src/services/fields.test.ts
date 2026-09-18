import type { Column } from '@directus/schema';
import type { Field, SchemaOverview } from '@directus/types';
import type { Knex } from 'knex';
import knex from 'knex';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FieldsService } from './fields.js';

vi.mock('directus/version', () => ({ version: '0.0.0' }));

vi.mock('../database/index.js', () => {
	return {
		__esModule: true,
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
		getSchemaInspector: vi.fn(),
	};
});

vi.mock('../cache.js', () => ({
	getCache: () => ({ cache: null, systemCache: null }),
	clearSystemCache: vi.fn(),
}));

const schema: SchemaOverview = { collections: {}, relations: [] };

const existingColumn = (overrides: Partial<Column> = {}): Column => ({
	name: 'status',
	table: 'ugyviteli_folyamat_futas',
	data_type: 'character varying',
	default_value: 'in_progress',
	max_length: 16,
	numeric_precision: null,
	numeric_scale: null,
	is_nullable: false,
	is_unique: false,
	is_primary_key: false,
	is_generated: false,
	generation_expression: null,
	has_auto_increment: false,
	foreign_key_table: null,
	foreign_key_column: null,
	...overrides,
});

const targetField = (overrides: Partial<NonNullable<Field['schema']>> = {}): Field => ({
	collection: 'ugyviteli_folyamat_futas',
	field: 'status',
	name: 'status',
	type: 'string',
	meta: null,
	schema: existingColumn({ max_length: 32, ...overrides }),
});

let db: Knex;
let service: FieldsService;

beforeAll(() => {
	db = knex({ client: 'pg' });
	service = new FieldsService({ knex: db, schema });
});

function alterStatements(field: Field, alter: Column): string[] {
	return db.schema
		.alterTable(field.collection, (table) => {
			service.addColumnToTable(table, field, alter);
		})
		.toSQL()
		.map((statement) => statement.sql);
}

describe('FieldsService.addColumnToTable on alter', () => {
	it('keeps NOT NULL when only the column length changes', () => {
		const statements = alterStatements(targetField(), existingColumn());

		expect(statements).toContainEqual(expect.stringContaining('type varchar(32)'));
		expect(statements).not.toContainEqual(expect.stringContaining('drop not null'));
		expect(statements).not.toContainEqual(expect.stringContaining('set not null'));
	});

	it('adds NOT NULL when the column becomes non-nullable', () => {
		const statements = alterStatements(targetField(), existingColumn({ is_nullable: true }));

		expect(statements).toContainEqual(expect.stringContaining('set not null'));
	});

	it('drops NOT NULL when the column becomes nullable', () => {
		const statements = alterStatements(targetField({ is_nullable: true }), existingColumn());

		expect(statements).toContainEqual(expect.stringContaining('drop not null'));
		expect(statements).not.toContainEqual(expect.stringContaining('set not null'));
	});
});
