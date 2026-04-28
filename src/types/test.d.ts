export interface TestCase {
  name: string;
  function: () => Promise<void>;
}

export type TestResult = TestResultSuccess | TestResultFailed;

interface TestResultSuccess extends TestResultBase {
  status: "success";
}

interface TestResultFailed extends TestResultBase {
  status: "failed";
  error: TestError;
}

interface TestResultBase {
  name: string;
  duration: number;
  startTime: number;
}

interface TestError {
  message: string;
  type: "timeout" | "error";
  location?: string | undefined;
}
