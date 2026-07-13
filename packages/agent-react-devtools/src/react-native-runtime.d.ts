declare module 'react-native' {
  export const AppState: {
    currentState?: string | null;
    isAvailable?: boolean;
  };

  export const Platform: {
    OS: string;
    constants: {
      reactNativeVersion?: {
        major: number;
        minor: number;
        patch: number;
        prerelease?: string | null;
      } | null;
    };
  };
}

declare module 'react-native/Libraries/Core/Devtools/getDevServer' {
  interface DevServerInfo {
    bundleLoadedFromServer: boolean;
    url: string;
  }

  export default function getDevServer(): DevServerInfo;
}
