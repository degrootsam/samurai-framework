import type { Extensible, ResultData } from "../bidi.js";

export interface CommandResponse extends Extensible {
  type: "success";
  id: number;
  result: ResultData;
}
