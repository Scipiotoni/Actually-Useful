/*
 * Turns compiler messages and crashes into plain English for a beginner.
 *
 * The compiler's own words are always shown too — learning to read them is
 * part of the course — but each one gets a short "what this usually means".
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LearnExplain = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STD_NAMES = {
    cout: 'iostream', cin: 'iostream', cerr: 'iostream', endl: 'iostream',
    string: 'string', getline: 'string', to_string: 'string', stoi: 'string', stod: 'string',
    vector: 'vector', array: 'array', map: 'map', set: 'set', unordered_map: 'unordered_map',
    unordered_set: 'unordered_set', pair: 'utility', swap: 'utility', move: 'utility',
    sort: 'algorithm', reverse: 'algorithm', max: 'algorithm', min: 'algorithm', find: 'algorithm',
    count: 'algorithm', accumulate: 'numeric', sqrt: 'cmath', pow: 'cmath', abs: 'cmath',
    floor: 'cmath', ceil: 'cmath', round: 'cmath', setprecision: 'iomanip', setw: 'iomanip',
    fixed: 'iostream', unique_ptr: 'memory', shared_ptr: 'memory', make_unique: 'memory',
    make_shared: 'memory', optional: 'optional', function: 'functional', stringstream: 'sstream',
    istringstream: 'sstream', ostringstream: 'sstream', ifstream: 'fstream', ofstream: 'fstream',
    numeric_limits: 'limits', stack: 'stack', queue: 'queue', priority_queue: 'queue', deque: 'deque',
    isdigit: 'cctype', isalpha: 'cctype', toupper: 'cctype', tolower: 'cctype', isspace: 'cctype',
    mt19937: 'random', uniform_int_distribution: 'random', random_device: 'random', tuple: 'tuple',
    variant: 'variant', runtime_error: 'stdexcept', invalid_argument: 'stdexcept', out_of_range: 'stdexcept'
  };

  /** Patterns tried in order; the first that matches explains the message. */
  var RULES = [
    {
      re: /redefinition of '(?:int )?main\(\)'|multiple definition of `main'/,
      say: function () {
        return 'There are two `main()` functions. In a "write the function" exercise the checker brings its own `main()` — delete yours (or rename it) and keep only the functions asked for.';
      }
    },
    {
      re: /expected ';' before/,
      say: function () {
        return 'A statement is missing its semicolon `;`. The compiler notices at the *next* token, so the missing `;` is usually at the end of the line **before** the one it points at.';
      }
    },
    {
      re: /'(std::)?(\w+)' was not declared in this scope|use of undeclared identifier '(\w+)'|'(\w+)' is not a member of 'std'/,
      say: function (m) {
        var name = m[2] || m[3] || m[4];
        var header = STD_NAMES[name];
        if (header && !m[1] && !m[4]) {
          return 'C++ doesn\'t know `' + name + '` by itself. It lives in the standard library: write `std::' + name + '` (and make sure `#include <' + header + '>` is at the top).';
        }
        if (header) {
          return '`std::' + name + '` needs its header: add `#include <' + header + '>` at the top of the file.';
        }
        return 'C++ doesn\'t know anything called `' + name + '` here. Check the spelling (C++ is case-sensitive: `Total` and `total` are different), that it was declared *before* this line, and that you\'re inside the `{ }` where it exists.';
      }
    },
    {
      re: /expected '\}' at end of input/,
      say: function () {
        return 'A `{` is never closed. Every `{` needs a matching `}` — count them, and look at where your indentation stops making sense.';
      }
    },
    {
      re: /expected unqualified-id before|expected declaration before '\}'/,
      say: function () {
        return 'There is something where C++ expected a new declaration — often an extra `}` that closed a function too early, or a statement written outside any function.';
      }
    },
    {
      re: /does not name a type/,
      say: function () {
        return 'C++ expected a type (like `int` or `std::string`) here. Either the type is misspelled or missing its header/`std::`, or a statement ended up outside a function (only declarations may live there).';
      }
    },
    {
      re: /missing terminating (?:"|') character|unterminated string/,
      say: function () {
        return 'A piece of text is never closed. Every `"` needs a partner on the same line — and characters use single quotes: `\'a\'`.';
      }
    },
    {
      re: /stray '\\?\d+' in program|non-ASCII characters are not permitted/,
      say: function () {
        return 'There is an invisible or "smart" character in the code — usually curly quotes “ ” or ‘ ’ pasted from a document or chat. Retype the quotes by hand as plain `"` or `\'`.';
      }
    },
    {
      re: /expected primary-expression before/,
      say: function () {
        return 'A value was expected but something else is there: an operator with nothing after it, a stray symbol, or a type name used where a value belongs.';
      }
    },
    {
      re: /no match for 'operator>>'.*(?:std::ostream|basic_ostream)|no match for 'operator<<'.*(?:std::istream|basic_istream)/,
      say: function () {
        return 'The arrows point the wrong way. Output goes **out** with `std::cout << x`; input comes **in** with `std::cin >> x`.';
      }
    },
    {
      re: /no match for 'operator<<'/,
      say: function () {
        return '`std::cout` doesn\'t know how to print this kind of value — a whole vector, a struct, or a class. Print its parts one by one, or give the type an `operator<<`.';
      }
    },
    {
      re: /invalid operands of types 'const char \[\d+\]' and 'const char \[\d+\]' to binary 'operator\+'/,
      say: function () {
        return 'Two text literals can\'t be added with `+`. Make one of them a `std::string` first: `std::string("Hello ") + "world"` — or just print them one after the other with `<<`.';
      }
    },
    {
      re: /invalid operands of types/,
      say: function () {
        return 'This operator doesn\'t work on these types. Check what each side really is (an `int`? a `std::string`? a `char`?) — you may need a conversion such as `std::to_string` or `static_cast`.';
      }
    },
    {
      re: /narrowing conversion of/,
      say: function () {
        return 'Brace initialization `{}` refuses to lose information silently — e.g. putting `3.7` into an `int`. Use a type that fits, or convert on purpose with `static_cast`.';
      }
    },
    {
      re: /(?:cannot convert|invalid conversion from) '([^']+)' to '([^']+)'/,
      say: function (m) {
        return 'A `' + m[1] + '` was given where a `' + m[2] + '` is needed, and C++ won\'t convert between them automatically. Check the types of your variables, arguments and return value.';
      }
    },
    {
      re: /too few arguments to function|no matching function for call to|too many arguments to function/,
      say: function () {
        return 'The call doesn\'t match any version of that function: the number or the types of the arguments are different from its parameters. Compare the call with the function\'s first line.';
      }
    },
    {
      re: /redeclaration of|redefinition of|conflicting declaration/,
      say: function () {
        return 'The same name is declared twice in the same scope. Give the second one a different name, or reuse the first variable without repeating its type (`x = 5;` not `int x = 5;`).';
      }
    },
    {
      re: /return-statement with no value, in function returning|return-statement with a value, in function returning 'void'/,
      say: function () {
        return 'The `return` doesn\'t match the function\'s return type: a `void` function returns nothing, any other must `return` a value of its type.';
      }
    },
    {
      re: /no return statement in function returning non-void|control reaches end of non-void function/,
      say: function () {
        return 'This function promises to return a value, but some path reaches its end without a `return`. Using that missing value is undefined behaviour — make sure every path returns.';
      }
    },
    {
      re: /suggest parentheses around assignment used as truth value/,
      say: function () {
        return 'This condition *assigns* with `=`. To *compare*, use `==`: `if (x == 5)`.';
      }
    },
    {
      re: /lvalue required as left operand of assignment/,
      say: function () {
        return 'Only a variable can go on the left of `=`. Maybe you meant to compare with `==`, or the two sides are swapped (`x = 5`, not `5 = x`).';
      }
    },
    {
      re: /'else' without a previous 'if'/,
      say: function () {
        return 'This `else` has no `if` right before it. Usually a stray `;` right after `if (...)`, or a missing/extra `}` between them.';
      }
    },
    {
      re: /break statement not within loop or switch|continue statement not within a loop/,
      say: function () {
        return '`break` and `continue` only make sense inside a loop (and `break` inside a `switch`).';
      }
    },
    {
      re: /jump to case label|crosses initialization of/,
      say: function () {
        return 'A variable was declared inside a `case` without its own braces. Wrap that case\'s code in `{ }`.';
      }
    },
    {
      re: /comparison of integer expressions of different signedness/,
      say: function () {
        return 'A signed number (`int`) is compared with an unsigned one (like `v.size()`, which is a `std::size_t`). Use `std::size_t` for the index, or a range-based `for` loop.';
      }
    },
    {
      re: /unused variable '(\w+)'/,
      say: function (m) {
        return '`' + m[1] + '` is created but never used — just a warning, but often a sign of a typo or unfinished code.';
      }
    },
    {
      re: /'(\w+)' is used uninitialized|may be used uninitialized/,
      say: function () {
        return 'A variable is read before it was ever given a value. Its contents are garbage — always initialize: `int count{0};`.';
      }
    },
    {
      re: /is private within this context|is protected within this context/,
      say: function () {
        return 'That member is `private` (or `protected`): only the class\'s own member functions may touch it. Go through a public member function instead.';
      }
    },
    {
      re: /passing 'const [^']+' as 'this' argument discards qualifiers/,
      say: function () {
        return 'A non-`const` member function was called on a `const` object. If the function doesn\'t change the object, mark it `const`: `int size() const { ... }`.';
      }
    },
    {
      re: /request for member '(\w+)' in '[^']+', which is of pointer type/,
      say: function () {
        return 'This is a pointer, so reach its members with `->` (`p->' + '$1' + '`), not `.`.';
      }
    },
    {
      re: /base operand of '->' has non-pointer type/,
      say: function () {
        return 'This isn\'t a pointer, so use `.` to reach its members, not `->`.';
      }
    },
    {
      re: /use of deleted function .*unique_ptr/,
      say: function () {
        return 'A `std::unique_ptr` can\'t be copied — it is the *only* owner. Move it with `std::move(p)`, or pass it by reference.';
      }
    },
    {
      re: /use of deleted function/,
      say: function () {
        return 'This tries to use an operation the type has forbidden (often copying something that can\'t be copied). Pass it by reference or move it.';
      }
    },
    {
      re: /cannot declare variable '[^']+' to be of abstract type|invalid new-expression of abstract class type|cannot allocate an object of abstract type/,
      say: function () {
        return 'This class still has a pure virtual function (`= 0`) that nobody implemented, so it can\'t be created. Override every pure virtual function in the derived class.';
      }
    },
    {
      re: /marked 'override', but does not override/,
      say: function () {
        return '`override` caught a mismatch: no base-class virtual function has exactly this signature. Compare the name, parameters and `const` with the base class.';
      }
    },
    {
      re: /ISO C\+\+ forbids variable length array/,
      say: function () {
        return 'An array\'s size must be known when compiling. For a size decided at run time, use `std::vector<int> v(n);`.';
      }
    },
    {
      re: /undefined reference to `main'/,
      say: function () {
        return 'Every program needs a `main()` function — it is where running starts. Check it exists and is spelled `int main()`.';
      }
    },
    {
      re: /undefined reference to/,
      say: function () {
        return 'The linker found a *declaration* of this function but no *definition* (its body). Write the body, or check the name and parameters match exactly.';
      }
    },
    {
      re: /division by zero/,
      say: function () {
        return 'Dividing an integer by zero crashes the program. Check the divisor first.';
      }
    },
    {
      re: /statement has no effect|value computed is not used/,
      say: function () {
        return 'This line computes something and throws the result away — did you mean to assign it (`x = x + 1;`) or compare?';
      }
    },
    {
      re: /expected '\(' before|expected '\)' before|expected ',' or ';' before/,
      say: function () {
        return 'A bracket or separator is missing near here. Check that every `(` has its `)` and that items are separated correctly.';
      }
    },
    {
      re: /'(\w+)' has not been declared/,
      say: function (m) {
        return '`' + m[1] + '` is used before C++ has seen it declared. Declare it above, or check its spelling.';
      }
    },
    {
      re: /expected initializer before/,
      say: function () {
        return 'The declaration on this line is malformed — often a missing `;` on the line above, or a typo in a type or name.';
      }
    }
  ];

  /**
   * Splits compiler output into diagnostics.
   * @returns {Array<{file, line, column, severity, message, detail, hint}>}
   */
  function diagnostics(output) {
    var found = [];
    var lines = String(output || '').split('\n');
    var re = /^(?:\.\/)?([\w./+-]+):(\d+):(?:(\d+):)?\s*(fatal error|error|warning|note):\s*(.*)$/;
    var linker = /^(?:\/[^:]*:\s*)?(?:[\w./-]+\.o:?[^:]*:\s*)?(.*(?:undefined reference to|multiple definition of).*)$/;
    for (var i = 0; i < lines.length; i += 1) {
      var m = re.exec(lines[i]);
      if (m) {
        var detail = [];
        for (var j = i + 1; j < lines.length && !re.test(lines[j]) && !/^\S+: In /.test(lines[j]) && !/^In file included/.test(lines[j]); j += 1) {
          detail.push(lines[j]);
        }
        found.push({
          file: m[1],
          line: Number(m[2]),
          column: m[3] ? Number(m[3]) : null,
          severity: m[4] === 'fatal error' ? 'error' : m[4],
          message: m[5],
          detail: detail.join('\n').replace(/\s+$/, '')
        });
        continue;
      }
      var l = linker.exec(lines[i]);
      if (l && !/^collect2/.test(lines[i])) {
        found.push({ file: null, line: null, column: null, severity: 'error', message: l[1].trim(), detail: '' });
      }
    }
    found.forEach(function (d) { d.hint = hintFor(d.message); });
    return found;
  }

  function hintFor(message) {
    for (var i = 0; i < RULES.length; i += 1) {
      var m = RULES[i].re.exec(message);
      if (m) return RULES[i].say(m).replace('$1', m[1] || '');
    }
    return '';
  }

  /** A plain-English account of how a run ended, or '' when it ended normally. */
  function runtime(run) {
    if (!run) return '';
    if (run.timedOut) {
      return 'The program ran too long and was stopped. The usual cause is a loop whose condition never becomes false — check that the loop variable really changes. If the tests use large inputs, the code may simply be too slow: look for a faster algorithm. (Or the program waits for input that isn\'t in the Input box.)';
    }
    if (run.truncated) {
      return 'The program printed far too much and was stopped — most likely a loop that never ends.';
    }
    var stderr = String(run.stderr || '');
    if (/Assertion '__n < this->size\(\)' failed|__glibcxx_assert|_GLIBCXX_ASSERTIONS/.test(stderr)) {
      return 'An index was out of range: `v[i]` with `i` not between `0` and `v.size() - 1`. Check your loop bounds — the last valid index is `size() - 1`.';
    }
    if (/std::out_of_range/.test(stderr)) {
      return 'An `.at()` call (or similar) was given an index outside the container, and threw `std::out_of_range`. Check the index against `size()`.';
    }
    if (/terminate called after throwing an instance of '([^']+)'/.test(stderr)) {
      var type = /terminate called after throwing an instance of '([^']+)'/.exec(stderr)[1];
      return 'An exception of type `' + type + '` was thrown and nothing caught it, so the program stopped. Catch it with `try { ... } catch (...)`, or prevent the error.';
    }
    if (/Assertion .* failed/.test(stderr)) {
      return 'An `assert` failed: something the program assumed to be true wasn\'t. The message above says which condition.';
    }
    switch (run.signal) {
      case 'SIGSEGV':
        return 'Segmentation fault: the program touched memory it doesn\'t own. Typical causes: an index past the end of an array, dereferencing a null or dangling pointer, or endless recursion.';
      case 'SIGFPE':
        return 'Arithmetic error: almost always an integer division (or `%`) by zero.';
      case 'SIGABRT':
        return 'The program aborted — a failed check or an unhandled error. Read the message above.';
      case 'SIGKILL':
        return 'The program was stopped for using too much time or memory.';
      default:
        break;
    }
    if (run.exitCode && run.exitCode !== 0) {
      return '`main` finished with code ' + run.exitCode + '. By convention 0 means success; any other number reports a problem.';
    }
    return '';
  }

  return { diagnostics: diagnostics, hintFor: hintFor, runtime: runtime, STD_NAMES: STD_NAMES };
});
