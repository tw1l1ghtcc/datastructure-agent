import { cAlgorithm } from './c-algorithms.js';
import { dAlgorithm } from './d-algorithms.js';
import { fAlgorithm } from './f-algorithms.js';
export function dataAlgorithm(id) { return cAlgorithm(id) ?? dAlgorithm(id) ?? fAlgorithm(id); }
