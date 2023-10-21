import * as readline from 'node:readline'

import executors, { type ScenarioOptions, type ScenarioProgress, type Executor } from './executors.ts'
import log from './log.ts'
import * as metrics from '@negrel/denoload-metrics'
import { padLeft, printMetrics } from './utils.ts'
import { WorkerPool } from './worker_pool.ts'

const logger = log.getLogger('runner')

/**
 * Options defines options exported by a test script.
 */
export interface TestOptions {
  scenarios: Record<string, ScenarioOptions>
}

export async function run (moduleURL: URL): Promise<void> {
  logger.debug(`loading options of module "${moduleURL.toString()}"...`)
  const moduleOptions = await loadOptions(moduleURL)
  logger.debug('options loaded', moduleOptions)
  if (moduleOptions === null) {
    logger.error('no options object exported from test module')
    return
  }

  // Create scenarios executors
  const workerPool = new WorkerPool()
  const execs: Executor[] = Object.entries(moduleOptions.scenarios).map(([scenarioName, scenarioOptions]) =>
    new executors[scenarioOptions.executor](workerPool, scenarioName, moduleURL, scenarioOptions))

  // Print progress every second.
  const printProgress = progressPrinter(workerPool, execs)
  const intervalId = setInterval(printProgress, 1000)

  // Start scenarios.
  const promises = execs.map(async (e) => { await e.execute() })
  try {
    await Promise.all(promises)
  } catch (err) {
    clearInterval(intervalId)
    logger.error('failed to await scenarios executions', err)
    return
  }

  // Stop progress report.
  clearInterval(intervalId)
  readline.moveCursor(process.stdout, 0, (execs.length + 1) * -1)
  readline.clearScreenDown(process.stdout)

  // Collect & print metrics.
  const metricsPromises = await workerPool.forEachWorkerRemoteProcedureCall<never, metrics.RegistryObj>({
    name: 'metrics',
    args: []
  })
  if (metricsPromises.some((p) => p.status === 'rejected')) {
    logger.error('some metrics were lost, result may be innacurate')
  }
  const vuMetrics = metricsPromises.reduce<metrics.RegistryObj[]>((acc, p) => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    if (p.status === 'fulfilled') acc.push(p.value!)
    return acc
  }, [])
  printMetrics(metrics.mergeRegistryObjects(...vuMetrics))
  await printProgress()

  // Clean up.
  workerPool.terminate()
  logger.info('scenarios successfully executed, exiting...')
}

async function loadOptions (moduleURL: URL): Promise<TestOptions | null> {
  return (await import(moduleURL.toString()))?.options
}

function progressPrinter (workerPool: WorkerPool, execs: Executor[]): () => Promise<void> {
  const startTime = new Date().getTime()
  const maxVUs = execs.reduce((acc, e) => acc + e.maxVUs(), 0)

  // Write some empty line so we don't erase previous lines
  // when printing progress report.
  console.log('\n'.repeat(execs.length + 1))

  return async () => {
    const promises = await workerPool.forEachWorkerRemoteProcedureCall<never, Record<string, number>>({
      name: 'iterationsDone',
      args: []
    })

    const iterationsDone: Record<string, number> = {}
    let iterationsTotal = 0
    for (const p of promises) {
      if (p.status === 'rejected') {
        logger.error('failed to collect iterations done', p.reason)
        continue
      }

      for (const scenario in p.value) {
        if (iterationsDone[scenario] === undefined) iterationsDone[scenario] = 0

        iterationsDone[scenario] += p.value[scenario]
        iterationsTotal += p.value[scenario]
      }
    }

    const currentVUs = execs.reduce((acc, e) => acc + e.currentVUs(), 0)
    readline.moveCursor(process.stdout, 0, (execs.length + 1) * -1)
    readline.clearScreenDown(process.stdout)

    console.log(`running (${formatRunningSinceTime(startTime)}), ${currentVUs}/${maxVUs}VUs, ${iterationsTotal} complete iterations`)
    execs.forEach((exec) => {
      const scenarioProgress = exec.scenarioProgress({ startTime, iterationsDone: iterationsDone[exec.scenarioName] })
      printScenarioProgress(exec.scenarioName, scenarioProgress)
    })
  }
}

function formatRunningSinceTime (startTime: number): string {
  const runningSince = new Date().getTime() - startTime
  let seconds = Math.floor(runningSince / 1000)
  const minutes = Math.floor(seconds / 60)
  seconds = seconds % 60

  return `${padLeft(minutes.toString(), '0', 2)}m${padLeft(seconds.toString(), '0', 2)}s`
}

function printScenarioProgress (scenarioName: string, progress: ScenarioProgress): void {
  const progressBarEmptyChar =
      '--------------------------------------------------'
  const progressBarFullChar =
      '=================================================='

  const percentage = Math.floor(progress.percentage)

  console.log(
    `${scenarioName} ${progress.percentage === 100 ? '✓' : ' '} [${
      progressBarFullChar.slice(0, Math.floor(percentage / 2))
    }${
      progressBarEmptyChar.slice(0, progressBarEmptyChar.length - Math.floor(percentage / 2))
    }]`
  )
}