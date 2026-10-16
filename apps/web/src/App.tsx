import { useState, useRef, useMemo, useEffect } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Coins,
  Cpu,
  FileCheck2,
  FileText,
  FlaskConical,
  Layers,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  X,
} from 'lucide-react';
import {
  type PriorAuthCase,
  type MedicalPolicy,
  type AssessmentResult,
  type StepTrace,
  type IndexedResource,
  FhirBundleIndexer,
} from '@openpa/core';
import {
  TieredOrchestrator,
  createEvaluationStrategy,
  type StrategyName,
} from '@openpa/evaluators';
import {
  CounterfactualMutator,
  type MutationType,
  type MutationApplicationResult,
} from '@openpa/eval-suite';
import { BUNDLED_CASES, BUNDLED_POLICIES, MEASURED_BENCHMARK_REPORT } from './data';
import { ResearchPanel } from './ResearchPanel';
import { ProviderPanel } from './ProviderPanel';

const MUTATION_OPTIONS: Array<{ type: MutationType; label: string; desc: string }> = [
  {
    type: 'shorten_therapy_duration',
    label: 'Shorten Conservative Therapy Duration',
    desc: 'Compresses therapy sessions below policy lookback / minimum requirement',
  },
  {
    type: 'diagnosis_non_indicated',
    label: 'Replace Diagnosis with Non-Indicated Code',
    desc: 'Substitutes primary diagnosis code with unrelated clinical condition',
  },
  {
    type: 'temporal_expiry',
    label: 'Shift Evidence Outside Lookback Window',
    desc: 'Moves prerequisite diagnostic procedures/evaluations beyond lookback limit',
  },
  {
    type: 'clinical_negation',
    label: 'Inject Clinical Negation / Refutation',
    desc: 'Appends contradictory clinical notes and sets condition clinicalStatus to refuted',
  },
  {
    type: 'laterality_mismatch',
    label: 'Inject Laterality Mismatch',
    desc: 'Flips diagnostic/exam laterality to the contralateral side',
  },
];

export function App() {
  const [activeTab, setActiveTab] = useState<'research' | 'workbench' | 'benchmark'>('research');
  const [executionMode, setExecutionMode] = useState<'offline' | 'server'>('server');
  const [providerStatus, setProviderStatus] = useState('Connecting to local evaluator...');
  const [selectedCaseId, setSelectedCaseId] = useState<string>(BUNDLED_CASES[0].id);
  const [strategy, setStrategy] = useState<StrategyName>('tiered');
  const [activeMutationType, setActiveMutationType] = useState<MutationType | null>(null);
  const [mutationResult, setMutationResult] = useState<MutationApplicationResult | null>(null);
  const [currentCase, setCurrentCase] = useState<PriorAuthCase>(BUNDLED_CASES[0]);
  const [assessment, setAssessment] = useState<AssessmentResult | null>(null);
  const [executionTrace, setExecutionTrace] = useState<StepTrace[]>([]);
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'snippet' | 'raw'>('snippet');
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>('');

  const evalRunIdRef = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    void checkProviders();
    const escape = (event: KeyboardEvent) => {if(event.key === 'Escape') setSelectedResourceId(null);};
    window.addEventListener('keydown', escape);
    return () => {window.removeEventListener('keydown', escape);abortRef.current?.abort();};
  }, []);
  const checkProviders = async () => {
    try {
      const response = await fetch('/api/status');if(!response.ok)throw new Error();const status=await response.json();
      setProviderStatus(`Jev: ${status.jev.configured ? status.jev.model : 'unconfigured'} · Small: ${status.small.configured ? status.small.model : 'unconfigured'} · Frontier: ${status.frontier.configured ? status.frontier.model : 'unconfigured'}`);
    } catch {setProviderStatus('Local evaluator unavailable. Start npm run serve; offline evaluation remains available.');}
  };

  const policyMap = useMemo(() => {
    const map = new Map<string, MedicalPolicy>();
    BUNDLED_POLICIES.forEach(p => map.set(p.id, p));
    return map;
  }, []);

  const activePolicy = policyMap.get(currentCase.policyId);

  // Chronologically indexed bundle resources via core indexer
  const indexedBundle = useMemo(() => {
    return new FhirBundleIndexer(currentCase.patientBundle);
  }, [currentCase.patientBundle]);

  const chronologicalResources = useMemo(() => {
    return indexedBundle.getAllResources();
  }, [indexedBundle]);

  // Selected resource for drawer
  const inspectedResource: IndexedResource | undefined = useMemo(() => {
    if (!selectedResourceId) return undefined;
    return indexedBundle.getResourceById(selectedResourceId);
  }, [selectedResourceId, indexedBundle]);

  // Handle case change
  const handleCaseChange = (caseId: string) => {
    abortRef.current?.abort();
    evalRunIdRef.current += 1;
    setSelectedCaseId(caseId);
    setActiveMutationType(null);
    setMutationResult(null);
    const found = BUNDLED_CASES.find(c => c.id === caseId) || BUNDLED_CASES[0];
    setCurrentCase(found);
    setAssessment(null);
    setExecutionTrace([]);
    setSelectedResourceId(null);
    setEvaluationError(null);
    setIsEvaluating(false);
    setLiveAnnouncement(`Selected case: ${found.title}`);
  };

  // Handle strategy change
  const handleStrategyChange = (newStrategy: StrategyName) => {
    abortRef.current?.abort();
    evalRunIdRef.current += 1;
    setStrategy(newStrategy);
    setAssessment(null);
    setExecutionTrace([]);
    setEvaluationError(null);
    setIsEvaluating(false);
  };

  // Handle mutation selection
  const handleMutationChange = (mutationTypeStr: string) => {
    abortRef.current?.abort();
    evalRunIdRef.current += 1;
    setAssessment(null);
    setExecutionTrace([]);
    setEvaluationError(null);
    setSelectedResourceId(null);
    setIsEvaluating(false);

    const originalBaseline = BUNDLED_CASES.find(c => c.id === selectedCaseId) || BUNDLED_CASES[0];

    if (!mutationTypeStr || mutationTypeStr === 'none') {
      setActiveMutationType(null);
      setMutationResult(null);
      setCurrentCase(originalBaseline);
      setLiveAnnouncement('Reset case to unmodified baseline');
      return;
    }

    const type = mutationTypeStr as MutationType;
    const res = CounterfactualMutator.applyMutation(originalBaseline, type);
    setActiveMutationType(type);
    setMutationResult(res);
    setCurrentCase(res.mutatedCase);
    setLiveAnnouncement(`Applied mutation: ${type}`);
  };

  // Run evaluation
  const handleEvaluate = async () => {
    if (!activePolicy) return;
    const runId = ++evalRunIdRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsEvaluating(true);
    setEvaluationError(null);
    setAssessment(null);
    setExecutionTrace([]);
    setLiveAnnouncement('Starting prior authorization evaluation cascade...');

    try {
      if (executionMode === 'server' && strategy !== 'simulation') {
        const response = await fetch('/api/evaluate', {method:'POST',headers:{'Content-Type':'application/json','X-OpenPA-Request':'1'},body:JSON.stringify({caseId:selectedCaseId,strategy,mutation:activeMutationType}),signal:controller.signal});
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'Server evaluation failed');
        if (runId === evalRunIdRef.current) {setAssessment(payload.assessment);setExecutionTrace(payload.assessment.executionTrace);setLiveAnnouncement(`Evaluation complete: ${payload.assessment.disposition.replace(/_/g,' ')}`);}
        return;
      }
      const evaluators = createEvaluationStrategy(strategy);

      const orchestrator = new TieredOrchestrator(evaluators, {
        budgetCapUsd: 0.05,
        signal: controller.signal,
        onStep: step => {
          if (runId === evalRunIdRef.current) {
            setExecutionTrace(prev => [...prev, step]);
          }
        },
      });

      const res = await orchestrator.evaluateCase(currentCase, activePolicy);

      if (runId === evalRunIdRef.current) {
        setAssessment(res);
        setExecutionTrace(res.executionTrace);
        const avgConf =
          res.requirements.length > 0
            ? res.requirements.reduce((acc, r) => acc + r.confidence, 0) / res.requirements.length
            : 1;
        setLiveAnnouncement(
          `Evaluation complete. Disposition: ${res.disposition.replace(/_/g, ' ')}. Confidence: ${(avgConf * 100).toFixed(0)}%.`
        );
      }
    } catch (err) {
      if (runId === evalRunIdRef.current) {
        const msg = err instanceof Error ? err.message : String(err);
        setEvaluationError(msg);
        setLiveAnnouncement(`Evaluation failed: ${msg}`);
      }
    } finally {
      if (runId === evalRunIdRef.current) {
        setIsEvaluating(false);
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Live Region for Screen Readers */}
      <div role="status" aria-live="polite" className="sr-only">
        {liveAnnouncement}
      </div>

      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 rounded-lg">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              OpenPA Eval Workbench
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">
                Synthetic FHIR R4 research
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Evidence grounding · confidence routing · model regression evaluation
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode Tabs */}
          <nav aria-label="Workbench tabs" className="flex items-center bg-slate-850 p-1 rounded-lg border border-slate-700/80 mr-2">
            <button type="button" aria-pressed={activeTab === 'research'} onClick={() => setActiveTab('research')} className={`px-3 py-2 rounded-md text-sm ${activeTab === 'research' ? 'bg-indigo-600 text-white' : 'text-slate-300'}`}>Model comparison</button>
            <button
              type="button"
              onClick={() => setActiveTab('workbench')}
              aria-pressed={activeTab === 'workbench'}
              className={`px-3 py-1 rounded-md text-xs font-medium transition focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none ${
                activeTab === 'workbench'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Interactive Workbench
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('benchmark')}
              aria-pressed={activeTab === 'benchmark'}
              className={`px-3 py-1 rounded-md text-xs font-medium transition focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none ${
                activeTab === 'benchmark'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Measured Benchmarks
            </button>
          </nav>

          <span className="text-xs px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            100% Synthetic Data
          </span>
          <span className="text-xs px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700 flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
            Zero Autonomous Denials
          </span>
        </div>
      </header>

      <ProviderPanel />
      {activeTab === 'research' ? <ResearchPanel /> : activeTab === 'benchmark' ? (
        /* Benchmark Results View */
        <main className="flex-1 p-6 flex flex-col gap-6 max-w-7xl mx-auto w-full overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  Structured Synthetic Baseline Report
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                    Stored rules run
                  </span>
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Dataset Version: {MEASURED_BENCHMARK_REPORT.datasetVersion} | Run Mode: {MEASURED_BENCHMARK_REPORT.runMode} | Strategy: {MEASURED_BENCHMARK_REPORT.strategy}
                </p>
              </div>
              <span className="text-xs text-slate-500 font-mono">
                {new Date(MEASURED_BENCHMARK_REPORT.timestamp).toLocaleString()}
              </span>
            </div>

            {/* Metric KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-slate-850 p-4 rounded-lg border border-slate-800">
                <span className="text-xs text-slate-400 font-medium block">Disposition Accuracy</span>
                <span className="text-2xl font-bold text-emerald-400 mt-1 block">
                  {(MEASURED_BENCHMARK_REPORT.aggregate.dispositionAccuracy * 100).toFixed(1)}%
                </span>
                <span className="text-[11px] text-slate-400">{MEASURED_BENCHMARK_REPORT.aggregate.caseScores.filter(c => c.dispositionMatch).length} / {MEASURED_BENCHMARK_REPORT.aggregate.totalCases} cases matched</span>
              </div>

              <div className="bg-slate-850 p-4 rounded-lg border border-slate-800">
                <span className="text-xs text-slate-400 font-medium block">Grounding Precision</span>
                <span className="text-2xl font-bold text-emerald-400 mt-1 block">
                  {(MEASURED_BENCHMARK_REPORT.aggregate.meanGroundingPrecision * 100).toFixed(1)}%
                </span>
                <span className="text-[11px] text-slate-400">{MEASURED_BENCHMARK_REPORT.aggregate.totalUnsupportedCitations} unsupported citations</span>
              </div>

              <div className="bg-slate-850 p-4 rounded-lg border border-slate-800">
                <span className="text-xs text-slate-400 font-medium block">Missing Evidence Recall</span>
                <span className="text-2xl font-bold text-indigo-400 mt-1 block">
                  {(MEASURED_BENCHMARK_REPORT.aggregate.missingEvidenceRecall * 100).toFixed(1)}%
                </span>
                <span className="text-[11px] text-slate-500">Exact requirement ID tracking</span>
              </div>

              <div className="bg-slate-850 p-4 rounded-lg border border-slate-800">
                <span className="text-xs text-slate-400 font-medium block">Counterfactual Sensitivity</span>
                <span className="text-2xl font-bold text-amber-400 mt-1 block">
                  {(MEASURED_BENCHMARK_REPORT.sensitivity.counterfactualSensitivity * 100).toFixed(1)}%
                </span>
                <span className="text-[11px] text-slate-500">
                  {MEASURED_BENCHMARK_REPORT.sensitivity.totalCorrectlyFlipped} / {MEASURED_BENCHMARK_REPORT.sensitivity.totalMutationsEvaluated} flips verified
                </span>
              </div>
            </div>

            {/* Case-by-Case Breakdown Table */}
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
              Golden Case Results Table ({MEASURED_BENCHMARK_REPORT.aggregate.caseScores.length} Cases)
            </h3>
            <div className="overflow-x-auto border border-slate-800 rounded-lg">
              <table className="w-full text-xs text-left text-slate-300">
                <thead className="bg-slate-850 text-slate-400 uppercase text-[10px] font-semibold border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">Case ID</th>
                    <th className="py-2.5 px-3">Expected</th>
                    <th className="py-2.5 px-3">Predicted</th>
                    <th className="py-2.5 px-3">Match</th>
                    <th className="py-2.5 px-3">Req Accuracy</th>
                    <th className="py-2.5 px-3">Grounding</th>
                    <th className="py-2.5 px-3">Cost</th>
                    <th className="py-2.5 px-3">Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {MEASURED_BENCHMARK_REPORT.aggregate.caseScores.map((c: any) => (
                    <tr key={c.caseId} className="hover:bg-slate-850/50">
                      <td className="py-2.5 px-3 font-mono text-[11px] text-indigo-300">{c.caseId}</td>
                      <td className="py-2.5 px-3">{c.expectedDisposition}</td>
                      <td className="py-2.5 px-3">{c.predictedDisposition}</td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
                          {c.dispositionMatch ? 'PASS' : 'FAIL'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono">{(c.requirementAccuracy * 100).toFixed(0)}%</td>
                      <td className="py-2.5 px-3 font-mono">{(c.groundingPrecision * 100).toFixed(0)}%</td>
                      <td className="py-2.5 px-3 font-mono">${c.costUsd.toFixed(4)}</td>
                      <td className="py-2.5 px-3 font-mono">{c.latencyMs}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      ) : (
        /* Interactive Workbench View */
        <>
          {/* Control Toolbar */}
          <section
            aria-label="Evaluation toolbar"
            className="bg-slate-900 border-b border-slate-800 px-6 py-3 flex flex-wrap items-center justify-between gap-4"
          >
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="execution-select" className="text-sm text-slate-300">Execution</label>
              <select id="execution-select" value={executionMode} onChange={e => {setExecutionMode(e.target.value as 'offline' | 'server');handleStrategyChange(strategy);}} className="bg-slate-800 border border-slate-600 rounded p-2 text-sm"><option value="offline">Offline — no model calls</option><option value="server">Local evaluator — live providers</option></select>
              <button onClick={checkProviders} className="text-sm border border-slate-600 rounded px-3 py-2">Check providers</button>
              <span className="text-xs text-slate-300 max-w-xl" role="status">{providerStatus}</span>
              <label htmlFor="case-select" className="text-xs text-slate-400 font-medium">
                Select Case:
              </label>
              <select
                id="case-select"
                value={selectedCaseId}
                onChange={e => handleCaseChange(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {BUNDLED_CASES.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({c.scenarioCategory.toUpperCase()})
                  </option>
                ))}
              </select>

              <label htmlFor="strategy-select" className="text-xs text-slate-400 font-medium ml-2">
                Inference Strategy:
              </label>
              <select
                id="strategy-select"
                value={strategy}
                onChange={e => handleStrategyChange(e.target.value as StrategyName)}
                className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="rules">Tier 1: Deterministic Rules Only ($0.00)</option>
                <option value="cheap">Rules → Jev</option>
                <option value="tiered">Rules → Jev → small LLM → frontier</option>
                <option value="llm">Generative baseline</option>
                <option value="simulation">Simulation Mode (Explicit Mock LLM Fixture)</option>
              </select>

              <label htmlFor="mutation-select" className="text-xs text-slate-400 font-medium ml-2">
                Adversarial Mutation:
              </label>
              <select
                id="mutation-select"
                value={activeMutationType || 'none'}
                onChange={e => handleMutationChange(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="none">None (Baseline Unmodified)</option>
                {MUTATION_OPTIONS.map(m => (
                  <option key={m.type} value={m.type}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3">
              {activeMutationType && (
                <button
                  type="button"
                  onClick={() => handleMutationChange('none')}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-750 flex items-center gap-1.5 transition focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset Baseline
                </button>
              )}

              <button
                type="button"
                onClick={handleEvaluate}
                disabled={isEvaluating}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm flex items-center gap-1.5 transition disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none"
              >
                <Cpu className="w-3.5 h-3.5" />
                {isEvaluating ? 'Evaluating Cascade...' : 'Evaluate Prior Auth'}
              </button>
            </div>
          </section>

          {/* Mutation Warning / Info Banner */}
          {mutationResult && (
            <aside aria-label="Active mutation notice" className="bg-amber-950/40 border-b border-amber-800/60 px-6 py-2.5 flex items-center justify-between text-xs text-amber-200">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  <strong className="font-semibold">Counterfactual Perturbation:</strong>{' '}
                  {mutationResult.explanation}
                </span>
                {!mutationResult.isApplicable && (
                  <span className="px-2 py-0.5 rounded bg-amber-900/80 text-amber-300 border border-amber-700/60 text-[10px]">
                    No-Op / Inapplicable to this scenario
                  </span>
                )}
              </div>
              <span className="text-[11px] text-amber-300/80 font-mono">
                Target: {mutationResult.expectedFlippedRequirementId || 'None'} → Expected:{' '}
                {mutationResult.expectedDisposition}
              </span>
            </aside>
          )}

          {/* Error Banner */}
          {evaluationError && (
            <div role="alert" className="bg-rose-950/60 border-b border-rose-800/60 px-6 py-2.5 flex items-center gap-2 text-xs text-rose-200">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>
                <strong>Evaluation Failed:</strong> {evaluationError}
              </span>
            </div>
          )}

          {/* Main Grid: 3-Column Layout */}
          <main className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden">
            {/* Column 1: Patient Chart & Chronological Timeline (4 cols) */}
            <div className="lg:col-span-4 bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-4 overflow-y-auto max-h-[calc(100vh-220px)]">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <FileText className="w-4 h-4 text-indigo-400" />
                  Chronological Record ({chronologicalResources.length})
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 font-mono">
                  {currentCase.id}
                </span>
              </div>

              {/* Prior Auth Requested Service */}
              <div className="bg-slate-850 p-3 rounded-lg border border-slate-800/80 text-xs">
                <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider block mb-1">
                  Service Request ({currentCase.requestedService.codeSystem.split('/').pop()})
                </span>
                <div className="font-semibold text-white">
                  {currentCase.requestedService.code}: {currentCase.requestedService.description}
                </div>
                <div className="text-[11px] text-slate-400 mt-1 flex flex-wrap gap-1 items-center">
                  <span>Indications:</span>
                  {currentCase.requestedService.diagnosisCodes.map(d => (
                    <span
                      key={d}
                      className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono text-[10px] border border-slate-700"
                    >
                      {d}
                    </span>
                  ))}
                  {currentCase.requestedService.laterality && (
                    <span className="px-1.5 py-0.2 rounded bg-indigo-950/60 text-indigo-300 font-mono text-[10px] border border-indigo-800/50">
                      Side: {currentCase.requestedService.laterality}
                    </span>
                  )}
                </div>
              </div>

              {/* Resource Timeline */}
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Indexed FHIR Timeline (Chronological)
                </span>

                {chronologicalResources.map((res, idx) => {
                  const isSelected = selectedResourceId === `${res.resourceType}/${res.id}`;
                  const primaryCoding = res.codings[0];

                  return (
                    <button
                      type="button"
                      key={`${res.resourceType}-${res.id}-${idx}`}
                      onClick={() => setSelectedResourceId(`${res.resourceType}/${res.id}`)}
                      aria-label={`View clinical resource ${res.resourceType} ${res.id}`}
                      className={`text-left p-3 rounded-lg border transition text-xs flex flex-col gap-1 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none ${
                        isSelected
                          ? 'bg-indigo-950/40 border-indigo-600/70'
                          : 'bg-slate-850 hover:bg-slate-800 border-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-800/40">
                          {res.resourceType}/{res.id}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {res.date || 'No explicit date'}
                        </span>
                      </div>

                      {primaryCoding && (
                        <div className="font-medium text-slate-200 mt-0.5">
                          {primaryCoding.code}: {primaryCoding.display || 'Clinical concept'}
                        </div>
                      )}

                      {res.textSnippet && (
                        <div className="text-[11px] text-slate-400 italic line-clamp-2 mt-0.5">
                          "{res.textSnippet}"
                        </div>
                      )}

                      <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-1">
                        {res.status && <span>Status: {res.status}</span>}
                        {res.laterality && <span>Laterality: {res.laterality}</span>}
                        {res.bodySite && <span>Site: {res.bodySite}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Column 2: Policy Checklist & Evidence Inspector (4 cols) */}
            <div className="lg:col-span-4 bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-4 overflow-y-auto max-h-[calc(100vh-220px)]">
              <div className="border-b border-slate-800 pb-3">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Stethoscope className="w-4 h-4 text-emerald-400" />
                  Coverage Policy Verification
                </h2>
                <p className="text-[11px] text-slate-400 mt-0.5">{activePolicy?.title}</p>
              </div>

              {/* Policy Header Box */}
              <div className="bg-slate-850 p-3 rounded-lg border border-slate-800/80 text-xs text-slate-300">
                <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider block mb-1">
                  Policy Summary
                </span>
                {activePolicy?.narrative}
              </div>

              {/* Requirement Checklist */}
              <div className="flex flex-col gap-3">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Policy Requirements ({activePolicy?.requirements.length || 0})
                </span>

                {activePolicy?.requirements.map(req => {
                  const evalItem = assessment?.requirements.find(r => r.requirementId === req.id);
                  const status = evalItem?.status;
                  const resolvingStep = executionTrace.find(s => s.requirementId === req.id);

                  return (
                    <div
                      key={req.id}
                      className={`p-3.5 rounded-lg border text-xs flex flex-col gap-2 transition ${
                        status === 'satisfied'
                          ? 'bg-emerald-950/20 border-emerald-800/40'
                          : status === 'insufficient_evidence'
                          ? 'bg-amber-950/20 border-amber-800/40'
                          : 'bg-slate-850 border-slate-800'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-slate-200 leading-snug">
                          {req.description}
                        </span>
                        {status === 'satisfied' && (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-medium shrink-0 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Satisfied
                          </span>
                        )}
                        {status === 'insufficient_evidence' && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-medium shrink-0 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" /> Missing
                          </span>
                        )}
                        {!status && (
                          <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px] shrink-0">
                            Pending
                          </span>
                        )}
                      </div>

                      {req.rationale && <p className="text-[11px] text-slate-400">{req.rationale}</p>}

                      {evalItem && (
                        <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-800/60">
                          <span>Confidence: {(evalItem.confidence * 100).toFixed(0)}%</span>
                          <span>
                            Resolved by:{' '}
                            {resolvingStep?.tierName ||
                              (evalItem.status === 'satisfied' ? 'Deterministic Rules' : 'Unresolved')}
                          </span>
                        </div>
                      )}

                      {/* Evidence Citations */}
                      {evalItem?.evidence && evalItem.evidence.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1.5 items-center">
                          <span className="text-[10px] text-slate-500">Citations:</span>
                          {evalItem.evidence.map((cit, i) => (
                            <button
                              type="button"
                              key={i}
                              onClick={() => setSelectedResourceId(cit.resourceId)}
                              aria-label={`Inspect cited resource ${cit.resourceId}`}
                              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-750 text-indigo-300 border border-indigo-700/40 text-[10px] font-mono transition focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none"
                            >
                              {cit.resourceId}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Evidence Inspector Drawer */}
              {inspectedResource && (
                <div className="p-3 bg-slate-850 border border-indigo-800/60 rounded-lg text-xs flex flex-col gap-2">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="font-semibold text-indigo-300 font-mono text-[11px]">
                      {inspectedResource.resourceType}/{inspectedResource.id}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setInspectorTab('snippet')}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                          inspectorTab === 'snippet'
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Snippet
                      </button>
                      <button
                        type="button"
                        onClick={() => setInspectorTab('raw')}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                          inspectorTab === 'raw'
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Raw JSON
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedResourceId(null)}
                        aria-label="Close resource inspector"
                        className="p-0.5 rounded text-slate-500 hover:text-slate-300 ml-1"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {inspectorTab === 'snippet' ? (
                    <div className="flex flex-col gap-1.5 text-[11px]">
                      {inspectedResource.textSnippet ? (
                        <p className="text-slate-200 italic bg-slate-900 p-2.5 rounded border border-slate-800">
                          "{inspectedResource.textSnippet}"
                        </p>
                      ) : (
                        <p className="text-slate-500 italic">No narrative text or note attached.</p>
                      )}
                      <div className="text-[10px] text-slate-400 flex flex-wrap gap-x-3 gap-y-1 mt-1">
                        <span>Date: {inspectedResource.date || 'Unspecified'}</span>
                        <span>Status: {inspectedResource.status || 'Unspecified'}</span>
                        {inspectedResource.laterality && <span>Laterality: {inspectedResource.laterality}</span>}
                      </div>
                    </div>
                  ) : (
                    <pre className="bg-slate-950 text-indigo-200 p-2.5 rounded text-[10px] font-mono overflow-x-auto max-h-56 border border-slate-800">
                      {JSON.stringify(inspectedResource.raw, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>

            {/* Column 3: Outcome, Trace & Sensitivity Check (4 cols) */}
            <div className="lg:col-span-4 bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-4 overflow-y-auto max-h-[calc(100vh-220px)]">
              <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-purple-400" />
                  Outcome & Trace
                </h2>
                {assessment && (
                  <span className="text-[10px] text-slate-400 flex items-center gap-1 font-mono">
                    <Clock className="w-3 h-3" /> {assessment.totalLatencyMs}ms
                  </span>
                )}
              </div>

              {/* Disposition Banner */}
              {assessment ? (
                <div
                  className={`p-4 rounded-xl border flex flex-col gap-2.5 ${
                    assessment.disposition === 'meets_policy'
                      ? 'bg-emerald-950/40 border-emerald-600/50 text-emerald-200'
                      : assessment.disposition === 'needs_information'
                      ? 'bg-amber-950/40 border-amber-600/50 text-amber-200'
                      : 'bg-blue-950/40 border-blue-600/50 text-blue-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase font-bold tracking-wider">Evaluation Disposition</span>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-900/80 border border-current">
                      {assessment.disposition.replace(/_/g, ' ').toUpperCase()}
                    </span>
                  </div>

                  <p className="text-xs opacity-90 leading-relaxed">
                    {assessment.disposition === 'meets_policy' &&
                      'Evidence satisfies the configured synthetic criteria. This assessment is not a payer authorization.'}
                    {assessment.disposition === 'needs_information' &&
                      'Prerequisite medical documentation is incomplete. Pended for additional provider documentation.'}
                    {assessment.disposition === 'requires_clinical_review' &&
                      'Ambiguity, narrative conflict, or budget bounds exceeded; safely routed to physician review.'}
                  </p>

                  <div className="pt-2 border-t border-current/20 flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1">
                      <Coins className="w-3.5 h-3.5" /> {assessment.costVerified === false ? 'ChatGPT plan / credits · dollar cost unverified' : `Cost: $${assessment.totalCostUsd.toFixed(4)} USD`}
                    </span>
                    <span>
                      Confidence:{' '}
                      {(
                        (assessment.requirements.length > 0
                          ? assessment.requirements.reduce((acc, r) => acc + r.confidence, 0) /
                            assessment.requirements.length
                          : 1) * 100
                      ).toFixed(0)}
                      %
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-8 border border-dashed border-slate-800 rounded-xl text-center text-slate-500 text-xs flex flex-col items-center gap-2">
                  <FileCheck2 className="w-8 h-8 opacity-40" />
                  Click "Evaluate Prior Auth" above to run the tiered cascade against this case.
                </div>
              )}

              {/* Counterfactual Verification Summary */}
              {assessment && mutationResult && (
                <div className="p-3 bg-slate-850 rounded-lg border border-amber-800/40 text-xs flex flex-col gap-1.5">
                  <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">
                    Counterfactual Sensitivity Verification
                  </span>
                  <div className="text-[11px] text-slate-300">
                    Expected Disposition:{' '}
                    <strong className="text-white">{mutationResult.expectedDisposition}</strong>
                  </div>
                  <div className="text-[11px] text-slate-300">
                    Actual Disposition:{' '}
                    <strong className="text-white">{assessment.disposition}</strong>
                  </div>
                  <div className="mt-1">
                    {assessment.disposition === mutationResult.expectedDisposition ? (
                      <span className="px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/50 text-[10px] font-semibold">
                        SENSITIVITY TEST PASSED: Perturbation successfully flipped decision
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800/50 text-[10px] font-semibold">
                        SENSITIVITY DIVERGENCE: Decision did not match expected flip
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Missing Information Checklist */}
              {assessment && assessment.missingInformation.length > 0 && (
                <div className="p-3 bg-slate-850 rounded-lg border border-amber-800/40 text-xs">
                  <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider block mb-1">
                    Missing Information Checklist ({assessment.missingInformation.length})
                  </span>
                  <ul className="list-disc list-inside text-slate-300 space-y-1 text-[11px]">
                    {assessment.missingInformation.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Step-by-Step Waterfall Execution Trace */}
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Tier Cascade Trace ({executionTrace.length})
                </span>

                {executionTrace.map((step, idx) => (
                  <div
                    key={`${step.stepNumber}-${idx}`}
                    className="p-2.5 rounded-lg bg-slate-850 border border-slate-800 text-xs flex flex-col gap-1.5"
                  >
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-semibold text-indigo-300 flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-indigo-900/60 border border-indigo-700/40 flex items-center justify-center text-[9px]">
                          {step.stepNumber}
                        </span>
                        {step.tierName}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider ${
                          step.status === 'success' ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40' :
                          step.status === 'escalated' ? 'bg-purple-950/60 text-purple-300 border border-purple-800/40' :
                          step.status === 'failed' ? 'bg-rose-950/60 text-rose-300 border border-rose-800/40' :
                          'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}>
                          {step.status}
                        </span>
                        <span className="text-slate-500 font-mono">{step.latencyMs}ms</span>
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-300">
                      <span className="text-slate-500">{step.requirementId}:</span> {step.decision}
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800">
                      <div className="flex items-center gap-3">
                        {step.modelCertainty != null && (
                          <span title="The model's assessment certainty in its finding">
                            AI Certainty: <strong className="text-slate-200">{(step.modelCertainty * 100).toFixed(0)}%</strong>
                          </span>
                        )}
                        <span title="Autonomous clearance confidence toward satisfying policy criteria">
                          Policy Clearance: <strong className={step.confidence >= 0.9 ? 'text-emerald-400' : 'text-slate-300'}>{(step.confidence * 100).toFixed(0)}%</strong>
                        </span>
                      </div>
                      <span>{step.costVerified === false ? 'ChatGPT plan / credits' : `Cost: $${step.costUsd.toFixed(4)}`}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </main>
        </>
      )}
    </div>
  );
}

export default App;
