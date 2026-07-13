import { resolve } from 'node:path';

type GetModulesRunBeforeMainModule = (entryFilePath: string) => string[];

interface SerializerConfig {
  getModulesRunBeforeMainModule?: GetModulesRunBeforeMainModule;
  [key: string]: unknown;
}

interface MetroConfig {
  serializer?: SerializerConfig;
  [key: string]: unknown;
}

type AgentMetroConfig<T extends MetroConfig> = T & {
  serializer: SerializerConfig & {
    getModulesRunBeforeMainModule: GetModulesRunBeforeMainModule;
  };
};

type MetroConfigFactory<Args extends unknown[], T extends MetroConfig> = (
  ...args: Args
) => T;

type AsyncMetroConfigFactory<Args extends unknown[], T extends MetroConfig> = (
  ...args: Args
) => Promise<T>;

const REACT_NATIVE_BOOTSTRAP_PATH = resolve(__dirname, 'react-native.js');

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T>)?.then === 'function';
}

function wrapMetroConfig<T extends MetroConfig>(config: T): AgentMetroConfig<T> {
  const serializer = config.serializer ?? {};
  const getModulesRunBeforeMainModule =
    serializer.getModulesRunBeforeMainModule;

  return {
    ...config,
    serializer: {
      ...serializer,
      getModulesRunBeforeMainModule(entryFilePath) {
        const modules =
          getModulesRunBeforeMainModule?.call(serializer, entryFilePath) ?? [];
        return modules.includes(REACT_NATIVE_BOOTSTRAP_PATH)
          ? modules
          : [...modules, REACT_NATIVE_BOOTSTRAP_PATH];
      },
    },
  } as AgentMetroConfig<T>;
}

export function withAgentReactDevTools<T extends MetroConfig>(
  config: T,
): AgentMetroConfig<T>;
export function withAgentReactDevTools<Args extends unknown[], T extends MetroConfig>(
  configFactory: MetroConfigFactory<Args, T>,
): (...args: Args) => AgentMetroConfig<T>;
export function withAgentReactDevTools<Args extends unknown[], T extends MetroConfig>(
  configFactory: AsyncMetroConfigFactory<Args, T>,
): (...args: Args) => Promise<AgentMetroConfig<T>>;
export function withAgentReactDevTools<T extends MetroConfig>(
  configPromise: Promise<T>,
): Promise<AgentMetroConfig<T>>;
export function withAgentReactDevTools<Args extends unknown[], T extends MetroConfig>(
  config:
    | T
    | MetroConfigFactory<Args, T>
    | AsyncMetroConfigFactory<Args, T>
    | Promise<T>,
):
  | AgentMetroConfig<T>
  | ((...args: Args) => AgentMetroConfig<T> | Promise<AgentMetroConfig<T>>)
  | Promise<AgentMetroConfig<T>> {
  if (typeof config === 'function') {
    const factory = config as (this: unknown, ...args: Args) => T | Promise<T>;
    return function wrappedMetroConfigFactory(this: unknown, ...args: Args) {
      const resolvedConfig = factory.apply(this, args);
      return isPromise(resolvedConfig)
        ? resolvedConfig.then(wrapMetroConfig)
        : wrapMetroConfig(resolvedConfig);
    };
  }

  return isPromise(config) ? config.then(wrapMetroConfig) : wrapMetroConfig(config);
}
