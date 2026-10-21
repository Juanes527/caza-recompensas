import type { Source } from "../types.ts";
import { descuentostech } from "./descuentostech.ts";
import { ofertu } from "./ofertu.ts";
import { promocajita } from "./promocajita.ts";

export const SOURCES: Source[] = [ofertu, descuentostech, promocajita];
