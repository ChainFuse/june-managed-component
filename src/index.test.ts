import crypto from 'crypto';

beforeAll(() => {
	vi.stubGlobal('crypto', crypto);
});

describe('june-so', () => {
	it('example test', () => {
		expect(true).toEqual(true);
	});
});
