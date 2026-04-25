interface FBInstantInterface {
  initializeAsync(): Promise<void>;
  startGameAsync(): Promise<void>;
  setLoadingProgress(progress: number): void;
  getEntryPointAsync(): Promise<string>;
  getEntryPointData(): any;
  platform: string;
  getSDKVersion(): string;
  getLocale(): string;
  // Add more as needed
}

declare const FBInstant: FBInstantInterface;
