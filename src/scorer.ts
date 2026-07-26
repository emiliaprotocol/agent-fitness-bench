// SPDX-License-Identifier: Apache-2.0
import type { Assertion, AssertionResult } from './types.js';

function printable(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

export function scoreOutput(output: string, assertions: readonly Assertion[]): AssertionResult[] {
  return assertions.map((assertion) => {
    if (assertion.kind === 'matches') {
      let passed = false;
      try {
        passed = new RegExp(assertion.value, assertion.flags).test(output);
      } catch (error) {
        return { assertion, passed: false, detail: `invalid regex: ${(error as Error).message}` };
      }
      return { assertion, passed, detail: `${passed ? 'matched' : 'did not match'} /${assertion.value}/${assertion.flags}` };
    }
    const haystack = assertion.case_sensitive ? output : output.toLocaleLowerCase('en-US');
    const needle = assertion.case_sensitive ? assertion.value : assertion.value.toLocaleLowerCase('en-US');
    const found = haystack.includes(needle);
    const passed = assertion.kind === 'contains' ? found : !found;
    return {
      assertion,
      passed,
      detail: `${assertion.kind} ${JSON.stringify(printable(assertion.value))}: ${passed ? 'pass' : 'fail'}`,
    };
  });
}
