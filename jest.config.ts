import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  // Mock Electron and native modules that aren't available in test
  moduleNameMapper: {
    '^electron$': '<rootDir>/src/__tests__/__mocks__/electron.ts',
  },
  // Don't transform node_modules except ESM packages
  transformIgnorePatterns: ['/node_modules/'],
  // Increase timeout for integration-style tests
  testTimeout: 15_000,
};

export default config;
