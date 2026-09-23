const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../utils/validators');

test('normalizePhone: berbagai format nomor Indonesia', () => {
  assert.equal(v.normalizePhone('081234567890'), '6281234567890');
  assert.equal(v.normalizePhone('0812-3456-7890'), '6281234567890');
  assert.equal(v.normalizePhone('81234567890'), '6281234567890');
  assert.equal(v.normalizePhone('+62 812 3456 7890'), '6281234567890');
  assert.equal(v.normalizePhone('6281234567890'), '6281234567890');
  assert.equal(v.normalizePhone('+62 0812 3456 7890'), '6281234567890');
});

test('normalizePhone: nomor luar negeri harus pakai +', () => {
  assert.equal(v.normalizePhone('+1 415 555 2671'), '14155552671');
  assert.equal(v.normalizePhone('14155552671'), null);
});

test('normalizePhone: input tidak valid', () => {
  assert.equal(v.normalizePhone(''), null);
  assert.equal(v.normalizePhone('abc'), null);
  assert.equal(v.normalizePhone('12345'), null);
  assert.equal(v.normalizePhone('0812'), null);
  assert.equal(v.normalizePhone(81234567890), null);
  assert.equal(v.normalizePhone(null), null);
});

test('extractDriveFolderId', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUv';
  assert.equal(v.extractDriveFolderId(`https://drive.google.com/drive/folders/${id}?usp=sharing`), id);
  assert.equal(v.extractDriveFolderId(`https://drive.google.com/drive/u/0/folders/${id}`), id);
  assert.equal(v.extractDriveFolderId(`https://drive.google.com/open?id=${id}`), id);
  assert.equal(v.extractDriveFolderId(`https://example.com/drive/folders/${id}`), null);
  assert.equal(v.extractDriveFolderId(`http://drive.google.com/drive/folders/${id}`), null);
  assert.equal(v.extractDriveFolderId('bukan link'), null);
  assert.equal(v.extractDriveFolderId(undefined), null);
});

test('parseMaxSelection', () => {
  assert.equal(v.parseMaxSelection(10), 10);
  assert.equal(v.parseMaxSelection('25'), 25);
  assert.equal(v.parseMaxSelection(0), null);
  assert.equal(v.parseMaxSelection(501), null);
  assert.equal(v.parseMaxSelection(2.5), null);
  assert.equal(v.parseMaxSelection(''), null);
  assert.equal(v.parseMaxSelection('abc'), null);
});

test('isUuid, isEmail, validPassword, cleanString', () => {
  assert.equal(v.isUuid('3f2b8c1e-9a4d-4e7b-8c21-5d6e7f8a9b0c'), true);
  assert.equal(v.isUuid('123'), false);
  assert.equal(v.isUuid("1' OR '1'='1"), false);
  assert.equal(v.isEmail('a@b.co'), true);
  assert.equal(v.isEmail('a@b'), false);
  assert.equal(v.validPassword('12345678', 8), true);
  assert.equal(v.validPassword('1234567', 8), false);
  assert.equal(v.validPassword('x'.repeat(73), 8), false);
  assert.equal(v.cleanString('  Wedding J&D  ', { max: 120 }), 'Wedding J&D');
  assert.equal(v.cleanString('   '), null);
  assert.equal(v.cleanString(123), null);
});
