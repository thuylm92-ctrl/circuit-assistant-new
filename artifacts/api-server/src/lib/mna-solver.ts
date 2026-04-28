/**
 * Modified Nodal Analysis (MNA) Solver
 * Supports DC and AC (sinusoidal steady-state) analysis for linear circuits.
 * Elements: R, C, L, V source, I source, VCVS, VCCS, CCVS, CCCS, op-amp
 */

export type ElementType =
  | "resistor"
  | "capacitor"
  | "inductor"
  | "voltage_source"
  | "current_source"
  | "vcvs"
  | "vccs"
  | "ccvs"
  | "cccs"
  | "wire"
  | "ground"
  | "opamp";

export interface CircuitElement {
  id: string;
  type: ElementType;
  nodeFrom: string;
  nodeTo: string;
  value?: number;
  unit?: string;
  label?: string;
  frequency?: number;
  controlBranchId?: string;
  gain?: number;
}

export interface CircuitNode {
  id: string;
  label?: string;
}

export interface CircuitInput {
  elements: CircuitElement[];
  nodes: CircuitNode[];
  analysisType?: "dc" | "ac";
  frequency?: number;
}

export interface NodeVoltage {
  nodeId: string;
  voltage: number;
  voltageImag?: number;
  unit: string;
}

export interface BranchCurrent {
  elementId: string;
  current: number;
  currentImag?: number;
  unit: string;
}

export interface CircuitSolution {
  nodeVoltages: NodeVoltage[];
  branchCurrents: BranchCurrent[];
  analysisType: string;
  /**
   * Rough condition number estimate of the MNA matrix, computed as the ratio
   * of the largest absolute pivot to the smallest absolute pivot encountered
   * during Gaussian elimination. Values above ~1e8 indicate the matrix is
   * close to singular and the numerical solution may carry significant
   * floating-point error. Omitted (undefined) when the matrix is 1x1 or no
   * elimination steps were performed.
   */
  conditionNumber?: number;
}

export interface SolveError {
  error: string;
  reason: "singular_matrix" | "disconnected_circuit" | "no_ground" | "unsupported_element" | "other";
  details?: string;
}

export interface ValidationIssue {
  type: string;
  message: string;
  elementId?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

// Complex number helpers
type Complex = [number, number]; // [real, imag]

function cAdd(a: Complex, b: Complex): Complex {
  return [a[0] + b[0], a[1] + b[1]];
}
function cSub(a: Complex, b: Complex): Complex {
  return [a[0] - b[0], a[1] - b[1]];
}
function cMul(a: Complex, b: Complex): Complex {
  return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
}
function cDiv(a: Complex, b: Complex): Complex {
  const denom = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / denom, (a[1] * b[0] - a[0] * b[1]) / denom];
}
function cInv(a: Complex): Complex {
  return cDiv([1, 0], a);
}
function cNeg(a: Complex): Complex {
  return [-a[0], -a[1]];
}

/**
 * Gaussian elimination with partial pivoting on a complex matrix.
 * Solves Ax = b, where A is n×n and b is n×1 complex.
 *
 * Returns:
 *   - { x, conditionEstimate } on success. conditionEstimate is computed as
 *     ‖A‖∞ × ‖A⁻¹‖∞ — the standard infinity-norm condition number — by
 *     augmenting the Gauss–Jordan elimination with the n×n identity matrix
 *     so we recover A⁻¹ alongside x for free (O(n³), same complexity class
 *     as the solve itself; n is at most a few dozen for student circuits).
 *     This is a true upper bound on the relative error amplification, unlike
 *     a raw pivot-ratio which partial pivoting can mask. Values above ~1e8
 *     mean the matrix is numerically close to singular. undefined when n <= 1.
 *   - null if the matrix is singular (smallest pivot below 1e-15).
 */
function solveLinearSystem(
  A: Complex[][],
  b: Complex[],
): { x: Complex[]; conditionEstimate?: number } | null {
  const n = A.length;

  // Compute ‖A‖∞ (max row sum of |a_ij|) on the *original* A before mutation.
  let aInfNorm = 0;
  for (let i = 0; i < n; i++) {
    let rowSum = 0;
    for (let j = 0; j < n; j++) {
      rowSum += Math.hypot(A[i][j][0], A[i][j][1]);
    }
    if (rowSum > aInfNorm) aInfNorm = rowSum;
  }

  // Augmented matrix: [A | b | I]. Width = n + 1 + n.
  // After full Gauss–Jordan: row i becomes [0...diag_i...0 | x_i | (A⁻¹)_i * diag_i]
  // and we recover x_i = aug[i][n] / aug[i][i] and (A⁻¹)_ij = aug[i][n+1+j] / aug[i][i].
  const totalCols = 2 * n + 1;
  const M: Complex[][] = A.map((row, i) => {
    const augRow: Complex[] = new Array(totalCols);
    for (let j = 0; j < n; j++) augRow[j] = row[j];
    augRow[n] = b[i];
    for (let j = 0; j < n; j++) augRow[n + 1 + j] = i === j ? [1, 0] : [0, 0];
    return augRow;
  });

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col;
    let maxVal = Math.abs(M[col][col][0]) + Math.abs(M[col][col][1]);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(M[row][col][0]) + Math.abs(M[row][col][1]);
      if (v > maxVal) {
        maxVal = v;
        maxRow = row;
      }
    }
    if (maxVal < 1e-15) return null; // Singular

    [M[col], M[maxRow]] = [M[maxRow], M[col]];

    const pivot = M[col][col];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = cDiv(M[row][col], pivot);
      for (let j = col; j < totalCols; j++) {
        M[row][j] = cSub(M[row][j], cMul(factor, M[col][j]));
      }
    }
  }

  // Recover x and A⁻¹ from the row-reduced augmented matrix.
  const x: Complex[] = new Array(n);
  // Compute ‖A⁻¹‖∞ = max over rows of A⁻¹ of the row sum of |entries|.
  // Note: row i of A⁻¹ is (M[i][n+1+j] / M[i][i]) for j = 0..n-1.
  let aInvInfNorm = 0;
  for (let i = 0; i < n; i++) {
    const diag = M[i][i];
    x[i] = cDiv(M[i][n], diag);
    let rowSum = 0;
    for (let j = 0; j < n; j++) {
      const inv = cDiv(M[i][n + 1 + j], diag);
      rowSum += Math.hypot(inv[0], inv[1]);
    }
    if (rowSum > aInvInfNorm) aInvInfNorm = rowSum;
  }

  const conditionEstimate =
    n > 1 && Number.isFinite(aInfNorm) && Number.isFinite(aInvInfNorm)
      ? aInfNorm * aInvInfNorm
      : undefined;
  return { x, conditionEstimate };
}

export function validateCircuit(input: CircuitInput): ValidationResult {
  const issues: ValidationIssue[] = [];
  const { elements, nodes } = input;

  // Check for ground node
  const groundElements = elements.filter((e) => e.type === "ground");
  const hasGroundViaNode = nodes.some((n) => n.id === "0" || n.label?.toLowerCase() === "gnd" || n.label?.toLowerCase() === "ground");
  const hasGroundViaGndElement = groundElements.length > 0;

  if (!hasGroundViaNode && !hasGroundViaGndElement && !elements.some((e) => e.nodeFrom === "0" || e.nodeTo === "0")) {
    issues.push({
      type: "no_ground",
      message: "电路中未找到接地节点（GND）。至少需要一个接地节点作为参考电位。",
    });
  }

  // Check all elements have valid value
  for (const el of elements) {
    if (el.type === "wire" || el.type === "ground") continue;
    if (el.value === undefined || el.value === null) {
      issues.push({
        type: "missing_value",
        message: `元件 ${el.label ?? el.id}（${el.type}）缺少数值。`,
        elementId: el.id,
      });
    }
    if (el.type === "resistor" && el.value !== undefined && el.value <= 0) {
      issues.push({
        type: "invalid_value",
        message: `电阻 ${el.label ?? el.id} 的值必须大于 0。`,
        elementId: el.id,
      });
    }
    if (el.type === "capacitor" && el.value !== undefined && el.value < 0) {
      issues.push({
        type: "invalid_value",
        message: `电容 ${el.label ?? el.id} 的值不能为负。`,
        elementId: el.id,
      });
    }
    if (el.type === "inductor" && el.value !== undefined && el.value < 0) {
      issues.push({
        type: "invalid_value",
        message: `电感 ${el.label ?? el.id} 的值不能为负。`,
        elementId: el.id,
      });
    }
    if ((el.type === "vcvs" || el.type === "vccs" || el.type === "ccvs" || el.type === "cccs") && !el.controlBranchId) {
      issues.push({
        type: "missing_control",
        message: `受控源 ${el.label ?? el.id} 缺少控制支路信息。`,
        elementId: el.id,
      });
    }
  }

  // Check for floating nodes (each non-ground node should appear at least once)
  const nodeSet = new Set<string>();
  for (const el of elements) {
    if (el.nodeFrom) nodeSet.add(el.nodeFrom);
    if (el.nodeTo) nodeSet.add(el.nodeTo);
  }
  const declaredNodes = new Set(nodes.map((n) => n.id));
  for (const n of declaredNodes) {
    if (n !== "0" && !nodeSet.has(n)) {
      issues.push({
        type: "floating_node",
        message: `节点 ${n} 声明了但没有连接任何元件。`,
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export function solveCircuit(input: CircuitInput): CircuitSolution | SolveError {
  const { elements, nodes, analysisType = "dc", frequency = 0 } = input;
  const omega = 2 * Math.PI * frequency; // angular frequency

  // Collect all nodes mentioned in elements
  const nodeSet = new Set<string>();
  for (const el of elements) {
    if (el.type === "wire" || el.type === "ground") {
      if (el.type === "ground") nodeSet.add(el.nodeFrom);
      continue;
    }
    nodeSet.add(el.nodeFrom);
    nodeSet.add(el.nodeTo);
  }
  // Also add declared nodes
  for (const n of nodes) nodeSet.add(n.id);

  // Remove ground (node "0") from the unknowns
  nodeSet.delete("0");
  const nodeList = Array.from(nodeSet);
  const nodeIndex: Record<string, number> = {};
  nodeList.forEach((n, i) => {
    nodeIndex[n] = i;
  });

  if (nodeList.length === 0) {
    return {
      error: "无法求解",
      reason: "other",
      details: "电路中没有有效节点。",
    };
  }

  // Voltage sources and inductors (in DC) require extra rows for branch currents
  const voltageSources: CircuitElement[] = [];
  const opamps: CircuitElement[] = [];

  for (const el of elements) {
    if (el.type === "voltage_source" || el.type === "vcvs" || el.type === "ccvs") {
      voltageSources.push(el);
    }
    if (el.type === "opamp") {
      opamps.push(el);
    }
    if (el.type === "inductor" && analysisType === "dc") {
      // DC: inductor is short circuit (zero voltage), add as voltage source with value 0
      voltageSources.push({ ...el, value: 0 });
    }
  }

  const n = nodeList.length;
  const m = voltageSources.length + opamps.length; // extra rows for V-sources and op-amps
  const dim = n + m;

  // Initialize MNA matrix Y and RHS vector J (complex)
  const Y: Complex[][] = Array.from({ length: dim }, () =>
    Array.from({ length: dim }, () => [0, 0] as Complex)
  );
  const J: Complex[] = Array.from({ length: dim }, () => [0, 0] as Complex);

  // Stamp function helpers
  const stamp = (row: number, col: number, val: Complex) => {
    if (row >= 0 && col >= 0 && row < dim && col < dim) {
      Y[row][col] = cAdd(Y[row][col], val);
    }
  };
  const stampRHS = (row: number, val: Complex) => {
    if (row >= 0 && row < dim) {
      J[row] = cAdd(J[row], val);
    }
  };

  const getNIdx = (nodeId: string): number => {
    if (nodeId === "0") return -1;
    return nodeIndex[nodeId] ?? -1;
  };

  // Map voltage source / opamp to extra row index
  const vsIndex: Record<string, number> = {};
  voltageSources.forEach((el, i) => {
    vsIndex[el.id] = n + i;
  });
  opamps.forEach((el, i) => {
    vsIndex[el.id] = n + voltageSources.length + i;
  });

  // Stamp each element
  for (const el of elements) {
    const p = getNIdx(el.nodeFrom);
    const q = getNIdx(el.nodeTo);

    if (el.type === "wire") {
      // Wire: connect nodes (treat as zero-resistance = add large conductance)
      // Actually we should short-circuit them. For simplicity stamp a very large conductance.
      const G: Complex = [1e12, 0];
      if (p >= 0) stamp(p, p, G);
      if (q >= 0) stamp(q, q, G);
      if (p >= 0 && q >= 0) {
        stamp(p, q, cNeg(G));
        stamp(q, p, cNeg(G));
      }
      continue;
    }

    if (el.type === "ground") {
      // Ground node is already reference (node "0"), no stamping needed
      continue;
    }

    if (el.type === "resistor") {
      if (!el.value || el.value === 0) continue;
      const G: Complex = [1 / el.value, 0];
      if (p >= 0) stamp(p, p, G);
      if (q >= 0) stamp(q, q, G);
      if (p >= 0 && q >= 0) {
        stamp(p, q, cNeg(G));
        stamp(q, p, cNeg(G));
      }
    } else if (el.type === "capacitor") {
      if (analysisType === "dc") {
        // DC: capacitor is open circuit (no stamp)
      } else {
        // AC: admittance = jωC
        if (!el.value) continue;
        const Y_cap: Complex = [0, omega * el.value];
        if (p >= 0) stamp(p, p, Y_cap);
        if (q >= 0) stamp(q, q, Y_cap);
        if (p >= 0 && q >= 0) {
          stamp(p, q, cNeg(Y_cap));
          stamp(q, p, cNeg(Y_cap));
        }
      }
    } else if (el.type === "inductor") {
      if (analysisType === "dc") {
        // Already added as voltage source with value 0 above
        // Stamp the voltage source entry
        const k = vsIndex[el.id];
        if (k === undefined) continue;
        if (p >= 0) { stamp(p, k, [1, 0]); stamp(k, p, [1, 0]); }
        if (q >= 0) { stamp(q, k, [-1, 0]); stamp(k, q, [-1, 0]); }
        stampRHS(k, [0, 0]);
      } else {
        // AC: impedance = jωL, admittance = 1/(jωL)
        if (!el.value || omega === 0) continue;
        const Y_ind = cInv([0, omega * el.value]);
        if (p >= 0) stamp(p, p, Y_ind);
        if (q >= 0) stamp(q, q, Y_ind);
        if (p >= 0 && q >= 0) {
          stamp(p, q, cNeg(Y_ind));
          stamp(q, p, cNeg(Y_ind));
        }
      }
    } else if (el.type === "current_source") {
      if (el.value === undefined) continue;
      // Positive current from nodeTo to nodeFrom (conventional current direction)
      if (p >= 0) stampRHS(p, [-el.value, 0]);
      if (q >= 0) stampRHS(q, [el.value, 0]);
    } else if (el.type === "voltage_source") {
      const k = vsIndex[el.id];
      if (k === undefined) continue;
      if (p >= 0) { stamp(p, k, [1, 0]); stamp(k, p, [1, 0]); }
      if (q >= 0) { stamp(q, k, [-1, 0]); stamp(k, q, [-1, 0]); }
      stampRHS(k, [el.value ?? 0, 0]);
    } else if (el.type === "vcvs") {
      // Voltage-Controlled Voltage Source: V_out = gain * V_control
      // controlBranchId refers to the element whose voltage controls this
      const k = vsIndex[el.id];
      if (k === undefined) continue;
      if (p >= 0) { stamp(p, k, [1, 0]); stamp(k, p, [1, 0]); }
      if (q >= 0) { stamp(q, k, [-1, 0]); stamp(k, q, [-1, 0]); }
      // Control: find control element
      const ctrlEl = elements.find((e) => e.id === el.controlBranchId);
      if (ctrlEl) {
        const cp = getNIdx(ctrlEl.nodeFrom);
        const cq = getNIdx(ctrlEl.nodeTo);
        const gain = el.gain ?? 1;
        if (cp >= 0) stamp(k, cp, [-gain, 0]);
        if (cq >= 0) stamp(k, cq, [gain, 0]);
      }
    } else if (el.type === "vccs") {
      // Voltage-Controlled Current Source: I_out = gain * V_control
      const ctrlEl = elements.find((e) => e.id === el.controlBranchId);
      if (!ctrlEl) continue;
      const cp = getNIdx(ctrlEl.nodeFrom);
      const cq = getNIdx(ctrlEl.nodeTo);
      const gain = el.gain ?? 1;
      // Output current flows from q to p
      if (p >= 0 && cp >= 0) stamp(p, cp, [gain, 0]);
      if (p >= 0 && cq >= 0) stamp(p, cq, [-gain, 0]);
      if (q >= 0 && cp >= 0) stamp(q, cp, [-gain, 0]);
      if (q >= 0 && cq >= 0) stamp(q, cq, [gain, 0]);
    } else if (el.type === "ccvs") {
      // Current-Controlled Voltage Source: V_out = gain * I_control
      const k = vsIndex[el.id];
      if (k === undefined) continue;
      if (p >= 0) { stamp(p, k, [1, 0]); stamp(k, p, [1, 0]); }
      if (q >= 0) { stamp(q, k, [-1, 0]); stamp(k, q, [-1, 0]); }
      // Find the controlling branch (which must also be a voltage source for current sensing)
      const ctrlEl = elements.find((e) => e.id === el.controlBranchId);
      if (ctrlEl) {
        const ctrlK = vsIndex[ctrlEl.id];
        if (ctrlK !== undefined) {
          const gain = el.gain ?? 1;
          stamp(k, ctrlK, [-gain, 0]);
        }
      }
    } else if (el.type === "cccs") {
      // Current-Controlled Current Source: I_out = gain * I_control
      const ctrlEl = elements.find((e) => e.id === el.controlBranchId);
      if (!ctrlEl) continue;
      const ctrlK = vsIndex[ctrlEl.id];
      if (ctrlK === undefined) continue;
      const gain = el.gain ?? 1;
      if (p >= 0) stamp(p, ctrlK, [gain, 0]);
      if (q >= 0) stamp(q, ctrlK, [-gain, 0]);
    } else if (el.type === "opamp") {
      // Ideal op-amp: V+ - V- = 0, output current from extra row
      // nodeFrom = V+, nodeTo = V-, we need a 3rd node for output
      // Simplified: V_out - V+ + V- = 0, add extra row
      const k = vsIndex[el.id];
      if (k === undefined) continue;
      // Constrain: V+ = V-
      if (p >= 0) stamp(k, p, [1, 0]);
      if (q >= 0) stamp(k, q, [-1, 0]);
    }
  }

  // Solve the system
  const result = solveLinearSystem(Y, J);

  if (result === null) {
    return {
      error: "电路方程组奇异，无法求解。",
      reason: "singular_matrix",
      details: "可能原因：电路中存在电压源回路、节点未连接接地，或电路拓扑导致方程无解。",
    };
  }

  const { x, conditionEstimate } = result;

  // Extract results
  const nodeVoltages: NodeVoltage[] = nodeList.map((nodeId, i) => ({
    nodeId,
    voltage: x[i][0],
    voltageImag: x[i][1],
    unit: "V",
  }));
  // Add ground
  nodeVoltages.push({ nodeId: "0", voltage: 0, voltageImag: 0, unit: "V" });

  // Compute branch currents for key elements
  const branchCurrents: BranchCurrent[] = [];

  for (const el of elements) {
    if (el.type === "wire" || el.type === "ground") continue;

    const p = getNIdx(el.nodeFrom);
    const q = getNIdx(el.nodeTo);
    const vp: Complex = p >= 0 ? [x[p][0], x[p][1]] : [0, 0];
    const vq: Complex = q >= 0 ? [x[q][0], x[q][1]] : [0, 0];
    const vDiff = cSub(vp, vq);

    let current: Complex = [0, 0];

    if (el.type === "resistor" && el.value && el.value !== 0) {
      current = cDiv(vDiff, [el.value, 0]);
    } else if (el.type === "capacitor" && analysisType === "ac" && el.value && omega !== 0) {
      const Y_cap: Complex = [0, omega * el.value];
      current = cMul(Y_cap, vDiff);
    } else if (el.type === "inductor" && analysisType === "dc") {
      const k = vsIndex[el.id];
      if (k !== undefined) current = [x[k][0], x[k][1]];
    } else if (el.type === "inductor" && analysisType === "ac" && el.value && omega !== 0) {
      const Z_ind: Complex = [0, omega * el.value];
      current = cDiv(vDiff, Z_ind);
    } else if (el.type === "current_source") {
      current = [el.value ?? 0, 0];
    } else if (el.type === "voltage_source" || el.type === "vcvs" || el.type === "ccvs") {
      const k = vsIndex[el.id];
      if (k !== undefined) current = [x[k][0], x[k][1]];
    }

    branchCurrents.push({
      elementId: el.id,
      current: current[0],
      currentImag: current[1],
      unit: "A",
    });
  }

  return {
    nodeVoltages,
    branchCurrents,
    analysisType,
    ...(conditionEstimate !== undefined ? { conditionNumber: conditionEstimate } : {}),
  };
}
