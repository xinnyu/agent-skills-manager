import { Command } from "commander";

import { version } from "../package.json";
import { registerInitCommand } from "./commands/init";
import { registerAddCommand } from "./commands/add";
import { registerCreateCommand } from "./commands/create";
import { registerRemoveCommand } from "./commands/remove";
import { registerSyncCommand } from "./commands/sync";
import { registerListCommand } from "./commands/list";
import { registerInfoCommand } from "./commands/info";
import { registerUpgradeCommand } from "./commands/upgrade";
import { registerDoctorCommand } from "./commands/doctor";
import { registerScanCommand } from "./commands/scan";
import { registerDiscoverCommand } from "./commands/discover";

const program = new Command();

program
  .name("asm")
  .description("Agent Skills Manager — manage Claude Code skills")
  .version(version);

registerInitCommand(program);
registerAddCommand(program);
registerCreateCommand(program);
registerRemoveCommand(program);
registerSyncCommand(program);
registerListCommand(program);
registerInfoCommand(program);
registerUpgradeCommand(program);
registerDoctorCommand(program);
registerScanCommand(program);
registerDiscoverCommand(program);

program.parse();
