import { test, expect } from 'vitest';
import { toPascalCase } from './utils';

test('toPascalCase converts hyphenated strings to PascalCase', () => {
  expect(toPascalCase('add-user')).toBe('AddUser');
  expect(toPascalCase('get-user-info')).toBe('GetUserInfo');
  expect(toPascalCase('delete-user-data')).toBe('DeleteUserData');
});

test('toPascalCase converts underscore strings to PascalCase', () => {
  expect(toPascalCase('add_user')).toBe('AddUser');
  expect(toPascalCase('get_user_info')).toBe('GetUserInfo');
  expect(toPascalCase('delete_user_data')).toBe('DeleteUserData');
});

test('toPascalCase converts space-separated strings to PascalCase', () => {
  expect(toPascalCase('add user')).toBe('AddUser');
  expect(toPascalCase('get user info')).toBe('GetUserInfo');
  expect(toPascalCase('delete user data')).toBe('DeleteUserData');
});

test('toPascalCase converts mixed separators to PascalCase', () => {
  expect(toPascalCase('add-user_data')).toBe('AddUserData');
  expect(toPascalCase('get_user-info')).toBe('GetUserInfo');
  expect(toPascalCase('delete user-data')).toBe('DeleteUserData');
});

test('toPascalCase converts forward slashes to PascalCase', () => {
  expect(toPascalCase('example-servers/everything')).toBe('ExampleServersEverything');
  expect(toPascalCase('api/v1/users')).toBe('ApiV1Users');
});

test('toPascalCase handles already PascalCase strings', () => {
  expect(toPascalCase('AddUser')).toBe('AddUser');
  expect(toPascalCase('GetUserInfo')).toBe('GetUserInfo');
});

test('toPascalCase handles camelCase strings', () => {
  expect(toPascalCase('addUser')).toBe('AddUser');
  expect(toPascalCase('getUserInfo')).toBe('GetUserInfo');
});

test('toPascalCase handles single words', () => {
  expect(toPascalCase('simple')).toBe('Simple');
  expect(toPascalCase('test')).toBe('Test');
});

test('toPascalCase handles edge cases', () => {
  expect(toPascalCase('')).toBe('');
  expect(toPascalCase('a')).toBe('A');
  expect(toPascalCase('_leading_underscore')).toBe('LeadingUnderscore');
  expect(toPascalCase('-leading-hyphen')).toBe('LeadingHyphen');
  expect(toPascalCase('trailing_underscore_')).toBe('TrailingUnderscore');
  expect(toPascalCase('trailing-hyphen-')).toBe('TrailingHyphen');
});

test('toPascalCase handles null and undefined', () => {
  expect(toPascalCase(null as any)).toBe('');
  expect(toPascalCase(undefined as any)).toBe('');
});
