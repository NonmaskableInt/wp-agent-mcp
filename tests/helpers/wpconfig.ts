import { execFileSync } from 'node:child_process';

/**
 * Toggles real wp-config.php constants in the dev container, so tests can exercise
 * DISALLOW_FILE_EDIT / DISALLOW_FILE_MODS / DISALLOW_UNFILTERED_HTML / AGENT_BRIDGE_* for real.
 * Every line is tagged so it can always be removed again.
 */
export const container = process.env.BRIDGE_TEST_CONTAINER;

const SCRIPT = `
$f = "/var/www/html/wp-config.php";
$s = file_get_contents($f);
[$mode, $name, $lit] = [$argv[1], $argv[2] ?? "", $argv[3] ?? ""];
if ($mode === "clear_all") {
  $s = preg_replace('/^.*\\/\\/ bridge-test:\\S+\\R/m', "", $s);
} else {
  $s = preg_replace('/^.*\\/\\/ bridge-test:' . preg_quote($name, "/") . '\\R/m', "", $s);
  if ($mode === "set") {
    $line = "define(\\"$name\\", $lit); // bridge-test:$name\\n";
    $s = preg_replace('/(\\/\\* That\\'s all)/', $line . '$1', $s, 1);
  }
}
file_put_contents($f, $s);
`;

const run = (...args: string[]) => execFileSync('podman', ['exec', container!, 'php', '-r', SCRIPT, '--', ...args], { encoding: 'utf8' });

export const set_constant = (name: string, literal = 'true') => run('set', name, literal);
export const unset_constant = (name: string) => run('unset', name);
export const clear_test_constants = () => run('clear_all');

/** Run PHP inside the container (as root) and return stdout. */
export const sh = (...cmd: string[]) => execFileSync('podman', ['exec', container!, ...cmd], { encoding: 'utf8' });
