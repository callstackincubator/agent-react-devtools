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

const REACT_NATIVE_BOOTSTRAP_PATH = resolve(__dirname, 'react-native.js');

export function withAgentReactDevTools<T extends MetroConfig>(
  config: T,
): AgentMetroConfig<T> {
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
