"use strict";

var CustomPromise;

{
  CustomPromise = function(fn) {
    if (!(this instanceof CustomPromise))
        throw new TypeError('CustomPromises must be constructed via new');
    if (typeof fn !== 'function') throw new TypeError('not a function');
    /** @type {!number} */
    this._state = 0;
    /** @type {!boolean} */
    this._handled = false;
    /** @type {CustomPromise|undefined} */
    this._value = undefined;
    /** @type {!Array<!Function>} */
    this._deferreds = [];

    doResolve(fn, this);
  }

  function AggregateError(errors, message) {
    this.name = 'AggregateError', this.errors = errors;
    this.message = message || '';
  }

  AggregateError.prototype = Error.prototype;

  function handle(self, deferred) {
    while (self._state === 3) {
        self = self._value;
    }
    if (self._state === 0) {
        self._deferreds.push(deferred);
        return;
    }
    self._handled = true;
    CustomPromise._immediateFn(function() {
        var cb = self._state === 1 ? deferred.onFulfilled : deferred.onRejected;
        if (cb === null) {
            (self._state === 1 ? resolve : reject)(deferred.promise, self._value);
            return;
        }
        var ret;
        try {
            ret = cb(self._value);
        } catch (e) {
            reject(deferred.promise, e);
            return;
        }
        resolve(deferred.promise, ret);
    });
  }

  function resolve(self, newValue) {
    try {
        // CustomPromise Resolution Procedure: https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure
        if (newValue === self)
            throw new TypeError('A promise cannot be resolved with itself.');
        if (
            newValue &&
            (typeof newValue === 'object' || typeof newValue === 'function')
        ) {
            var then = newValue.then;
            if (newValue instanceof CustomPromise) {
                self._state = 3;
                self._value = newValue;
                finale(self);
                return;
            } else if (typeof then === 'function') {
                doResolve(function() {then.apply(newValue, arguments)}, self);
                return;
            }
        }
        self._state = 1;
        self._value = newValue;
        finale(self);
    } catch (e) {
        reject(self, e);
    }
  }

  function reject(self, newValue) {
    self._state = 2;
    self._value = newValue;
    finale(self);
  }

  function finale(self) {
    if (self._state === 2 && self._deferreds.length === 0) {
        CustomPromise._immediateFn(function() {
            if (!self._handled) {
                CustomPromise._unhandledRejectionFn(self._value);
            }
        });
    }

    for (var i = 0, len = self._deferreds.length; i < len; i++) {
        handle(self, self._deferreds[i]);
    }
    self._deferreds = null;
  }

  /**
  * @constructor
  */
  function Handler(onFulfilled, onRejected, promise) {
    this.onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : null;
    this.onRejected = typeof onRejected === 'function' ? onRejected : null;
    this.promise = promise;
  }

  function doResolve(fn, self) {
    var done = false;
    try {
        fn(
            function(value) {
                if (done) return;
                done = true;
                resolve(self, value);
            },
            function(reason) {
                if (done) return;
                done = true;
                reject(self, reason);
            }
        );
    } catch (ex) {
        if (done) return;
        done = true;
        reject(self, ex);
    }
  }

  CustomPromise.prototype['catch'] = function(onRejected) {
    return this.then(null, onRejected);
  };

  CustomPromise.prototype.then = function(onFulfilled, onRejected) {
    var prom = new this.constructor(function() {});
    handle(this, new Handler(onFulfilled, onRejected, prom));
    return prom;
  };

  CustomPromise.prototype['finally'] = function(callback) {
    var constructor = this.constructor;
    return this.then(
        function(value) {
            return constructor.resolve(callback()).then(function() {
                return value;
            });
        },
        function(reason) {
            return constructor.resolve(callback()).then(function() {
                return constructor.reject(reason);
            });
        }
    );
  };

  CustomPromise.all = function(arr) {
    return new CustomPromise(function(resolve, reject) {
        if (!Boolean(arr && typeof arr.length !== 'undefined')) {
            return reject(new TypeError('CustomPromise.all accepts an array'));
        }

        var args = Array.prototype.slice.call(arr);
        if (args.length === 0) return resolve([]);
        var remaining = args.length;

        function res(i, val) {
            try {
                if (val && (typeof val === 'object' || typeof val === 'function')) {
                    var then = val.then;
                    if (typeof then === 'function') {
                        then.call(
                            val,
                            function(val) {
                                res(i, val);
                            },
                            reject
                        );
                        return;
                    }
                }
                args[i] = val;
                if (--remaining === 0) {
                    resolve(args);
                }
            } catch (ex) {
                reject(ex);
            }
        }

        for (var i = 0; i < args.length; i++) {
            res(i, args[i]);
        }
    });
  };

  CustomPromise.any = function(arr) {
    var P = this;
    return new P(function(resolve, reject) {
        if (!(arr && typeof arr.length !== 'undefined')) {
            return reject(new TypeError('CustomPromise.any accepts an array'));
        }

        var args = Array.prototype.slice.call(arr);
        if (args.length === 0) return reject();

        var rejectionReasons = [];
        for (var i = 0; i < args.length; i++) {
            try {
                P.resolve(args[i])
                    .then(resolve)
                    .
                catch (function(error) {
                    rejectionReasons.push(error);
                    if (rejectionReasons.length === args.length) {
                        reject(
                            new AggregateError(
                                rejectionReasons,
                                'All promises were rejected'
                            )
                        );
                    }
                });
            } catch (ex) {
                reject(ex);
            }
        }
    });
  };

  CustomPromise.allSettled = function(arr) {
    var P = this;
    return new P(function(resolve, reject) {
        if (!(arr && typeof arr.length !== 'undefined')) {
            return reject(
                new TypeError(
                    typeof arr +
                    ' ' +
                    arr +
                    ' is not iterable(cannot read property Symbol(Symbol.iterator))'
                )
            );
        }
        var args = Array.prototype.slice.call(arr);
        if (args.length === 0) return resolve([]);
        var remaining = args.length;

        function res(i, val) {
            if (val && (typeof val === 'object' || typeof val === 'function')) {
                var then = val.then;
                if (typeof then === 'function') {
                    then.call(
                        val,
                        function(val) {
                            res(i, val);
                        },
                        function(e) {
                            args[i] = {
                                status: 'rejected',
                                reason: e
                            };
                            if (--remaining === 0) {
                                resolve(args);
                            }
                        }
                    );
                    return;
                }
            }
            args[i] = {
                status: 'fulfilled',
                value: val
            };
            if (--remaining === 0) {
                resolve(args);
            }
        }

        for (var i = 0; i < args.length; i++) {
            res(i, args[i]);
        }
    });
  };

  CustomPromise.resolve = function(value) {
    if (value && typeof value === 'object' && value.constructor === CustomPromise) {
        return value;
    }

    return new CustomPromise(function(resolve) {
        resolve(value);
    });
  };

  CustomPromise.reject = function(value) {
    return new CustomPromise(function(resolve, reject) {
        reject(value);
    });
  };

  CustomPromise.race = function(arr) {
    return new CustomPromise(function(resolve, reject) {
        if (!Boolean(arr && typeof arr.length !== 'undefined')) {
            return reject(new TypeError('CustomPromise.race accepts an array'));
        }

        for (var i = 0, len = arr.length; i < len; i++) {
            CustomPromise.resolve(arr[i]).then(resolve, reject);
        }
    });
  };

  CustomPromise._immediateFn = function(a) { a(); };

  CustomPromise._unhandledRejectionFn = function _unhandledRejectionFn(err) {
    if (typeof console !== 'undefined' && console) {
        console.warn('Possible Unhandled CustomPromise Rejection:', err);
    }
  };
}

function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function _regeneratorRuntime() { "use strict"; /*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/facebook/regenerator/blob/main/LICENSE */ _regeneratorRuntime = function _regeneratorRuntime() { return e; }; var t, e = {}, r = Object.prototype, n = r.hasOwnProperty, o = Object.defineProperty || function (t, e, r) { t[e] = r.value; }, i = "function" == typeof Symbol ? Symbol : {}, a = i.iterator || "@@iterator", c = i.asyncIterator || "@@asyncIterator", u = i.toStringTag || "@@toStringTag"; function define(t, e, r) { return Object.defineProperty(t, e, { value: r, enumerable: !0, configurable: !0, writable: !0 }), t[e]; } try { define({}, ""); } catch (t) { define = function define(t, e, r) { return t[e] = r; }; } function wrap(t, e, r, n) { var i = e && e.prototype instanceof Generator ? e : Generator, a = Object.create(i.prototype), c = new Context(n || []); return o(a, "_invoke", { value: makeInvokeMethod(t, r, c) }), a; } function tryCatch(t, e, r) { try { return { type: "normal", arg: t.call(e, r) }; } catch (t) { return { type: "throw", arg: t }; } } e.wrap = wrap; var h = "suspendedStart", l = "suspendedYield", f = "executing", s = "completed", y = {}; function Generator() {} function GeneratorFunction() {} function GeneratorFunctionPrototype() {} var p = {}; define(p, a, function () { return this; }); var d = Object.getPrototypeOf, v = d && d(d(values([]))); v && v !== r && n.call(v, a) && (p = v); var g = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(p); function defineIteratorMethods(t) { ["next", "throw", "return"].forEach(function (e) { define(t, e, function (t) { return this._invoke(e, t); }); }); } function AsyncIterator(t, e) { function invoke(r, o, i, a) { var c = tryCatch(t[r], t, o); if ("throw" !== c.type) { var u = c.arg, h = u.value; return h && "object" == _typeof(h) && n.call(h, "__await") ? e.resolve(h.__await).then(function (t) { invoke("next", t, i, a); }, function (t) { invoke("throw", t, i, a); }) : e.resolve(h).then(function (t) { u.value = t, i(u); }, function (t) { return invoke("throw", t, i, a); }); } a(c.arg); } var r; o(this, "_invoke", { value: function value(t, n) { function callInvokeWithMethodAndArg() { return new e(function (e, r) { invoke(t, n, e, r); }); } return r = r ? r.then(callInvokeWithMethodAndArg, callInvokeWithMethodAndArg) : callInvokeWithMethodAndArg(); } }); } function makeInvokeMethod(e, r, n) { var o = h; return function (i, a) { if (o === f) throw Error("Generator is already running"); if (o === s) { if ("throw" === i) throw a; return { value: t, done: !0 }; } for (n.method = i, n.arg = a;;) { var c = n.delegate; if (c) { var u = maybeInvokeDelegate(c, n); if (u) { if (u === y) continue; return u; } } if ("next" === n.method) n.sent = n._sent = n.arg;else if ("throw" === n.method) { if (o === h) throw o = s, n.arg; n.dispatchException(n.arg); } else "return" === n.method && n.abrupt("return", n.arg); o = f; var p = tryCatch(e, r, n); if ("normal" === p.type) { if (o = n.done ? s : l, p.arg === y) continue; return { value: p.arg, done: n.done }; } "throw" === p.type && (o = s, n.method = "throw", n.arg = p.arg); } }; } function maybeInvokeDelegate(e, r) { var n = r.method, o = e.iterator[n]; if (o === t) return r.delegate = null, "throw" === n && e.iterator["return"] && (r.method = "return", r.arg = t, maybeInvokeDelegate(e, r), "throw" === r.method) || "return" !== n && (r.method = "throw", r.arg = new TypeError("The iterator does not provide a '" + n + "' method")), y; var i = tryCatch(o, e.iterator, r.arg); if ("throw" === i.type) return r.method = "throw", r.arg = i.arg, r.delegate = null, y; var a = i.arg; return a ? a.done ? (r[e.resultName] = a.value, r.next = e.nextLoc, "return" !== r.method && (r.method = "next", r.arg = t), r.delegate = null, y) : a : (r.method = "throw", r.arg = new TypeError("iterator result is not an object"), r.delegate = null, y); } function pushTryEntry(t) { var e = { tryLoc: t[0] }; 1 in t && (e.catchLoc = t[1]), 2 in t && (e.finallyLoc = t[2], e.afterLoc = t[3]), this.tryEntries.push(e); } function resetTryEntry(t) { var e = t.completion || {}; e.type = "normal", delete e.arg, t.completion = e; } function Context(t) { this.tryEntries = [{ tryLoc: "root" }], t.forEach(pushTryEntry, this), this.reset(!0); } function values(e) { if (e || "" === e) { var r = e[a]; if (r) return r.call(e); if ("function" == typeof e.next) return e; if (!isNaN(e.length)) { var o = -1, i = function next() { for (; ++o < e.length;) if (n.call(e, o)) return next.value = e[o], next.done = !1, next; return next.value = t, next.done = !0, next; }; return i.next = i; } } throw new TypeError(_typeof(e) + " is not iterable"); } return GeneratorFunction.prototype = GeneratorFunctionPrototype, o(g, "constructor", { value: GeneratorFunctionPrototype, configurable: !0 }), o(GeneratorFunctionPrototype, "constructor", { value: GeneratorFunction, configurable: !0 }), GeneratorFunction.displayName = define(GeneratorFunctionPrototype, u, "GeneratorFunction"), e.isGeneratorFunction = function (t) { var e = "function" == typeof t && t.constructor; return !!e && (e === GeneratorFunction || "GeneratorFunction" === (e.displayName || e.name)); }, e.mark = function (t) { return Object.setPrototypeOf ? Object.setPrototypeOf(t, GeneratorFunctionPrototype) : (t.__proto__ = GeneratorFunctionPrototype, define(t, u, "GeneratorFunction")), t.prototype = Object.create(g), t; }, e.awrap = function (t) { return { __await: t }; }, defineIteratorMethods(AsyncIterator.prototype), define(AsyncIterator.prototype, c, function () { return this; }), e.AsyncIterator = AsyncIterator, e.async = function (t, r, n, o, i) { void 0 === i && (i = CustomPromise); var a = new AsyncIterator(wrap(t, r, n, o), i); return e.isGeneratorFunction(r) ? a : a.next().then(function (t) { return t.done ? t.value : a.next(); }); }, defineIteratorMethods(g), define(g, u, "Generator"), define(g, a, function () { return this; }), define(g, "toString", function () { return "[object Generator]"; }), e.keys = function (t) { var e = Object(t), r = []; for (var n in e) r.push(n); return r.reverse(), function next() { for (; r.length;) { var t = r.pop(); if (t in e) return next.value = t, next.done = !1, next; } return next.done = !0, next; }; }, e.values = values, Context.prototype = { constructor: Context, reset: function reset(e) { if (this.prev = 0, this.next = 0, this.sent = this._sent = t, this.done = !1, this.delegate = null, this.method = "next", this.arg = t, this.tryEntries.forEach(resetTryEntry), !e) for (var r in this) "t" === r.charAt(0) && n.call(this, r) && !isNaN(+r.slice(1)) && (this[r] = t); }, stop: function stop() { this.done = !0; var t = this.tryEntries[0].completion; if ("throw" === t.type) throw t.arg; return this.rval; }, dispatchException: function dispatchException(e) { if (this.done) throw e; var r = this; function handle(n, o) { return a.type = "throw", a.arg = e, r.next = n, o && (r.method = "next", r.arg = t), !!o; } for (var o = this.tryEntries.length - 1; o >= 0; --o) { var i = this.tryEntries[o], a = i.completion; if ("root" === i.tryLoc) return handle("end"); if (i.tryLoc <= this.prev) { var c = n.call(i, "catchLoc"), u = n.call(i, "finallyLoc"); if (c && u) { if (this.prev < i.catchLoc) return handle(i.catchLoc, !0); if (this.prev < i.finallyLoc) return handle(i.finallyLoc); } else if (c) { if (this.prev < i.catchLoc) return handle(i.catchLoc, !0); } else { if (!u) throw Error("try statement without catch or finally"); if (this.prev < i.finallyLoc) return handle(i.finallyLoc); } } } }, abrupt: function abrupt(t, e) { for (var r = this.tryEntries.length - 1; r >= 0; --r) { var o = this.tryEntries[r]; if (o.tryLoc <= this.prev && n.call(o, "finallyLoc") && this.prev < o.finallyLoc) { var i = o; break; } } i && ("break" === t || "continue" === t) && i.tryLoc <= e && e <= i.finallyLoc && (i = null); var a = i ? i.completion : {}; return a.type = t, a.arg = e, i ? (this.method = "next", this.next = i.finallyLoc, y) : this.complete(a); }, complete: function complete(t, e) { if ("throw" === t.type) throw t.arg; return "break" === t.type || "continue" === t.type ? this.next = t.arg : "return" === t.type ? (this.rval = this.arg = t.arg, this.method = "return", this.next = "end") : "normal" === t.type && e && (this.next = e), y; }, finish: function finish(t) { for (var e = this.tryEntries.length - 1; e >= 0; --e) { var r = this.tryEntries[e]; if (r.finallyLoc === t) return this.complete(r.completion, r.afterLoc), resetTryEntry(r), y; } }, "catch": function _catch(t) { for (var e = this.tryEntries.length - 1; e >= 0; --e) { var r = this.tryEntries[e]; if (r.tryLoc === t) { var n = r.completion; if ("throw" === n.type) { var o = n.arg; resetTryEntry(r); } return o; } } throw Error("illegal catch attempt"); }, delegateYield: function delegateYield(e, r, n) { return this.delegate = { iterator: values(e), resultName: r, nextLoc: n }, "next" === this.method && (this.arg = t), y; } }, e; }
function asyncGeneratorStep(n, t, e, r, o, a, c) { try { var i = n[a](c), u = i.value; } catch (n) { return void e(n); } i.done ? t(u) : CustomPromise.resolve(u).then(r, o); }
function _asyncToGenerator(n) { return function () { var t = this, e = arguments; return new CustomPromise(function (r, o) { var a = n.apply(t, e); function _next(n) { asyncGeneratorStep(a, r, o, _next, _throw, "next", n); } function _throw(n) { asyncGeneratorStep(a, r, o, _next, _throw, "throw", n); } _next(void 0); }); }; }
var onAppletInit = /*#__PURE__*/function () {
  var _ref = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee8(api) {
    var temporaryLabels, unhandledAliveCallLabels, aliveListenerByLabel, executeCreation, deleteTemporaryObjects, controlYOffset, checkboxUpdateHandlers, labelGroups, registerGroupMember, clearAllGroupMembers, createAttachedText, setupGroupCheckboxes, applyAllGroupCheckboxes, solveDerivativeAbscissaAndMakePoint, makeTangentSegment, setupDivisionAndGetSecantSlopeLabel, setupQuadraturePolygonAndPossiblyMuSegment, patchLineStyleOpacity, setupDivisions, sliderLabel, previousSliderValue, fLabel, inputBoxLabel, fPrimeLabel, derivativeAreaLabel, beginningAbscissaLabel;
    return _regeneratorRuntime().wrap(function _callee8$(_context9) {
      while (1) switch (_context9.prev = _context9.next) {
        case 0:
          // ================================================================================
          // Helpers regarding synchronization and temporary label tracking
          // ================================================================================
          temporaryLabels = [];
          unhandledAliveCallLabels = [];
          aliveListenerByLabel = {};
          executeCreation = function executeCreation(command, secondaryAliveListener, isPermanent) {
            return new CustomPromise(function (resolve, reject) {
              // Need to be able to tell apart main- from secondary labels
              if (command.indexOf('\n') >= 0) {
                reject("Encountered illegal command-count greater than one in command-string \"".concat(command, "\""));
                return;
              }
              var evaluationResult = api.evalCommandGetLabels(command);
              if (typeof evaluationResult !== "string") {
                reject("Failed at executing command \"".concat(command, "\""));
                return;
              }
              var createdLabels = evaluationResult.split(',');

              // There's no reason to use this helper for non-creational commands
              if (createdLabels.length == 0) {
                reject("Expected the command \"".concat(command, " to create at least one object\""));
                return;
              }
              var mainLabel = createdLabels[0];
              if (isPermanent !== true) temporaryLabels.push(mainLabel);
              if (typeof secondaryAliveListener === 'function') {
                for (var i = 1; i < createdLabels.length; ++i) {
                  var secondaryLabel = createdLabels[i];
                  if (isPermanent !== true) temporaryLabels.push(secondaryLabel);
                  if (unhandledAliveCallLabels.indexOf(secondaryLabel) >= 0) {
                    secondaryAliveListener(secondaryLabel);
                    continue;
                  }
                  aliveListenerByLabel[secondaryLabel] = secondaryAliveListener;
                }
              }
              if (unhandledAliveCallLabels.indexOf(mainLabel) >= 0) {
                resolve(mainLabel);
                return;
              }
              aliveListenerByLabel[mainLabel] = function () {
                return resolve(mainLabel);
              };
            });
          };
          deleteTemporaryObjects = function deleteTemporaryObjects() {
            aliveListenerByLabel = {};
            for (var i = temporaryLabels.length - 1; i >= 0; --i) api.deleteObject(temporaryLabels[i]);
            unhandledAliveCallLabels = [];
            temporaryLabels = [];
          };
          api.registerAddListener(function (addedLabel) {
            var listener = aliveListenerByLabel[addedLabel];
            if (listener && typeof listener == 'function') {
              delete aliveListenerByLabel[addedLabel];
              listener(addedLabel);
              return;
            }
            unhandledAliveCallLabels.push(addedLabel);
          });

          // ================================================================================
          // Scene definition
          // ================================================================================

          // Will be inaccessible behind the top-left corner's undo/redo otherwise
          controlYOffset = 80;
          checkboxUpdateHandlers = [];
          labelGroups = {
            GROUP_FUNCTION: {
              layer: 0,
              color: "#00d8f5",
              labelTextColor: "#000000",
              title: "Function",
              temporaryMembers: [],
              permanentMembers: []
            },
            GROUP_DERIVATIVE: {
              layer: 0,
              color: "#FF0000",
              labelTextColor: "#000000",
              title: "Derivative",
              temporaryMembers: [],
              permanentMembers: []
            },
            GROUP_QUADRATURE: {
              layer: 3,
              color: "#00FF00",
              labelTextColor: "#000000",
              title: "Quadrature Area",
              temporaryMembers: [],
              permanentMembers: []
            },
            GROUP_IRREGULAR: {
              layer: 2,
              color: "#FF0000",
              labelTextColor: "#000000",
              title: "Irregular Area",
              temporaryMembers: [],
              permanentMembers: []
            },
            GROUP_DIVISION: {
              layer: 4,
              color: "#f8ba2a",
              labelTextColor: "#000000",
              title: "Column Dividers",
              temporaryMembers: [],
              permanentMembers: []
            },
            GROUP_DIVISION_SECANT: {
              layer: 4,
              color: "#000000",
              labelTextColor: "#FFFFFF",
              title: "Division Secant",
              temporaryMembers: [],
              permanentMembers: []
            },
            GROUP_INTERVAL_SECANT: {
              layer: 4,
              color: "#1e00ff",
              labelTextColor: "#FFFFFF",
              title: "Interval Secant",
              temporaryMembers: [],
              permanentMembers: []
            },
            GROUP_DIVISION_TANGENT: {
              layer: 4,
              color: "#FF00FF",
              labelTextColor: "#FFFFFF",
              title: "Division Tangent",
              temporaryMembers: [],
              permanentMembers: []
            },
            GROUP_LEVEL_TERM_TANGENT: {
              layer: 4,
              color: "#8000FF",
              labelTextColor: "#FFFFFF",
              title: "Level Term Tangent",
              temporaryMembers: [],
              permanentMembers: []
            },
            GROUP_LEVEL_TERM: {
              layer: 4,
              color: "#8000FF",
              labelTextColor: "#FFFFFF",
              title: "Level Term Ordinate",
              temporaryMembers: [],
              permanentMembers: []
            },
            GROUP_MU_ABSCISSAS: {
              layer: 4,
              color: "#FF00FF",
              labelTextColor: "#FFFFFF",
              title: "μ Abscissas",
              temporaryMembers: [],
              permanentMembers: []
            },
            GROUP_MU_ORDINATES: {
              layer: 4,
              color: "#FF00FF",
              labelTextColor: "#FFFFFF",
              title: "μ Ordinates",
              temporaryMembers: [],
              permanentMembers: []
            },
            GROUP_INTERVAL_BOUNDS: {
              layer: 5,
              color: "#000000",
              labelTextColor: "#FFFFFF",
              title: "Interval Bounds",
              temporaryMembers: [],
              permanentMembers: []
            }
          };
          registerGroupMember = function registerGroupMember(label, group, permanent) {
            api.evalCommand("SetColor(".concat(label, ", \"").concat(group.color, "\")"));
            api.setLayer(label, group.layer);
            if (permanent === true) group.permanentMembers.push(label);else group.temporaryMembers.push(label);
          };
          clearAllGroupMembers = function clearAllGroupMembers() {
            var groupKeys = Object.keys(labelGroups);
            for (var groupKeyIndex = 0; groupKeyIndex < groupKeys.length; ++groupKeyIndex) labelGroups[groupKeys[groupKeyIndex]].temporaryMembers = [];
          };
          createAttachedText = /*#__PURE__*/function () {
            var _ref2 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee(x, y, label, isPermanent, value, color, backgroundColor) {
              var positionExpression, textLabel;
              return _regeneratorRuntime().wrap(function _callee$(_context) {
                while (1) switch (_context.prev = _context.next) {
                  case 0:
                    positionExpression = "AttachCopyToView((1,1), 1, (1,1), (0,0), (".concat(x, ",").concat(y, " + 23), (0,0))");
                    _context.next = 3;
                    return executeCreation("".concat(label, " = Text(").concat(value, ", ").concat(positionExpression, ")"), null, isPermanent);
                  case 3:
                    textLabel = _context.sent;
                    api.evalCommand("SetColor(".concat(textLabel, ", \"").concat(color, "\")"));
                    api.evalCommand("SetBackgroundColor(".concat(textLabel, ", \"").concat(backgroundColor, "\")"));
                    api.setLayer(textLabel, 9);
                    api.setFixed(textLabel, true, true);
                    return _context.abrupt("return", textLabel);
                  case 9:
                  case "end":
                    return _context.stop();
                }
              }, _callee);
            }));
            return function createAttachedText(_x2, _x3, _x4, _x5, _x6, _x7, _x8) {
              return _ref2.apply(this, arguments);
            };
          }();
          setupGroupCheckboxes = /*#__PURE__*/function () {
            var _ref3 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee2() {
              var groupKeys, _loop, groupKeyIndex;
              return _regeneratorRuntime().wrap(function _callee2$(_context3) {
                while (1) switch (_context3.prev = _context3.next) {
                  case 0:
                    checkboxUpdateHandlers = [];
                    groupKeys = Object.keys(labelGroups);
                    _loop = /*#__PURE__*/_regeneratorRuntime().mark(function _loop() {
                      var labelGroup, groupIndex, groupOffset, checkboxLabel, updateHandler;
                      return _regeneratorRuntime().wrap(function _loop$(_context2) {
                        while (1) switch (_context2.prev = _context2.next) {
                          case 0:
                            labelGroup = labelGroups[groupKeys[groupKeyIndex]];
                            groupIndex = controlYOffset / 32;
                            groupOffset = controlYOffset;
                            controlYOffset += 32;
                            _context2.next = 6;
                            return executeCreation("b_g_{".concat(groupIndex, "} = Checkbox()"), null, true);
                          case 6:
                            checkboxLabel = _context2.sent;
                            api.setLabelVisible(checkboxLabel, false);
                            api.setValue(checkboxLabel, 1);
                            api.setLayer(checkboxLabel, 9);
                            api.evalCommand("SetCoords(".concat(checkboxLabel, ", 5, ").concat(groupOffset, ")"));
                            _context2.next = 13;
                            return createAttachedText(45, groupOffset, "t_g_{".concat(groupIndex, "}"), true, "\"".concat(labelGroup.title, "\""), labelGroup.labelTextColor, labelGroup.color);
                          case 13:
                            updateHandler = function updateHandler() {
                              var visibility = api.getValue(checkboxLabel) == 1;
                              for (var i = 0; i < labelGroup.temporaryMembers.length; ++i) api.setVisible(labelGroup.temporaryMembers[i], visibility);
                              for (var _i = 0; _i < labelGroup.permanentMembers.length; ++_i) api.setVisible(labelGroup.permanentMembers[_i], visibility);
                            };
                            api.registerObjectUpdateListener(checkboxLabel, updateHandler);
                            checkboxUpdateHandlers.push(updateHandler);
                          case 16:
                          case "end":
                            return _context2.stop();
                        }
                      }, _loop);
                    });
                    groupKeyIndex = 0;
                  case 4:
                    if (!(groupKeyIndex < groupKeys.length)) {
                      _context3.next = 9;
                      break;
                    }
                    return _context3.delegateYield(_loop(), "t0", 6);
                  case 6:
                    ++groupKeyIndex;
                    _context3.next = 4;
                    break;
                  case 9:
                  case "end":
                    return _context3.stop();
                }
              }, _callee2);
            }));
            return function setupGroupCheckboxes() {
              return _ref3.apply(this, arguments);
            };
          }();
          applyAllGroupCheckboxes = function applyAllGroupCheckboxes() {
            for (var i = 0; i < checkboxUpdateHandlers.length; ++i) checkboxUpdateHandlers[i]();
          };
          solveDerivativeAbscissaAndMakePoint = function solveDerivativeAbscissaAndMakePoint(pointLabel, slopeValueLabel, minXValueLabel, maxXValueLabel) {
            return executeCreation("".concat(pointLabel, " = Point({Element(") + 'KeepIf(' + "x >= x(".concat(minXValueLabel, ") && x <= x(").concat(maxXValueLabel, "),") + "NSolutions(f' = ".concat(slopeValueLabel, ")") + ')' + ', 1), 0})');
          };
          makeTangentSegment = /*#__PURE__*/function () {
            var _ref4 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee3(labelNamePart, abscissaPointLabel, slopeLabel, pointAndSegmentLabelCallback) {
              var tangentFunctionLabel, tangentLength, segmentDeltaXLabel, sX, eX, segmentLabel, pointLabel;
              return _regeneratorRuntime().wrap(function _callee3$(_context4) {
                while (1) switch (_context4.prev = _context4.next) {
                  case 0:
                    _context4.next = 2;
                    return executeCreation("t_{".concat(labelNamePart, "}(x) = ").concat(slopeLabel, " * (x - x(").concat(abscissaPointLabel, ")) + f(x(").concat(abscissaPointLabel, "))"));
                  case 2:
                    tangentFunctionLabel = _context4.sent;
                    api.setVisible(tangentFunctionLabel, false);

                    /*
                      Keep the tangent line length constant, no matter it's slope.
                       Let t(x) = k*x be the tangent-function with slope k; let l be the segment length, with
                      l/2 being half of the symmetric length around the point of tangency; let a be the distance
                      travelled along the x-axis between the point of tangency and the segment's extremity; let u
                      be the abscissa of the point of tangency.
                       (l/2)^2 = (t(u + a) - t(u))^2 + a^2
                      (l/2)^2 = (k*(u + a) - k*u)^2 + a^2
                      (l/2)^2 = (k*u + k*a - k*u)^2 + a^2
                      (l/2)^2 = k^2*a^2 + a^2
                      l^2/4   = a^2 * (k^2 + 1)
                      l^2/(4*k^2 + 4)       = a^2
                      sqrt(l^2/(4*k^2 + 4)) = a
                      l/sqrt((4*k^2 + 4)) = a
                    */
                    tangentLength = .5;
                    _context4.next = 7;
                    return executeCreation("a_{".concat(labelNamePart, "} = ").concat(tangentLength, " / sqrt((4*").concat(slopeLabel, "^2 + 4))"));
                  case 7:
                    segmentDeltaXLabel = _context4.sent;
                    sX = "x(".concat(abscissaPointLabel, ") - ").concat(segmentDeltaXLabel);
                    eX = "x(".concat(abscissaPointLabel, ") + ").concat(segmentDeltaXLabel); // I've tried to simply plot the function t(x) in [sX;eX], but got horrible lag - thus, let's instantiate a segment manually
                    _context4.next = 12;
                    return executeCreation("t_s_{".concat(labelNamePart, "} = Segment((").concat(sX, ", ").concat(tangentFunctionLabel, "(").concat(sX, ")), (").concat(eX, ", ").concat(tangentFunctionLabel, "(").concat(eX, ")))"));
                  case 12:
                    segmentLabel = _context4.sent;
                    api.setLabelVisible(segmentLabel, false);
                    patchLineStyleOpacity(segmentLabel, 255);
                    if (pointAndSegmentLabelCallback) pointAndSegmentLabelCallback(segmentLabel);
                    _context4.next = 18;
                    return executeCreation("T_{".concat(labelNamePart, "} = Point({x(").concat(abscissaPointLabel, "), f(x(").concat(abscissaPointLabel, "))})"));
                  case 18:
                    pointLabel = _context4.sent;
                    api.setLabelVisible(pointLabel, false);
                    if (pointAndSegmentLabelCallback) pointAndSegmentLabelCallback(pointLabel);
                  case 21:
                  case "end":
                    return _context4.stop();
                }
              }, _callee3);
            }));
            return function makeTangentSegment(_x9, _x10, _x11, _x12) {
              return _ref4.apply(this, arguments);
            };
          }();
          setupDivisionAndGetSecantSlopeLabel = /*#__PURE__*/function () {
            var _ref5 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee4(divisionIndex, numberOfDivisions, previousPointLabel, currentPointLabel) {
              var divisionSecantLabel, secantSlopeLabel, abscissaPointLabel, fPrimePointLabel, fPrimeLineLabel;
              return _regeneratorRuntime().wrap(function _callee4$(_context5) {
                while (1) switch (_context5.prev = _context5.next) {
                  case 0:
                    if (!(numberOfDivisions != 1)) {
                      _context5.next = 6;
                      break;
                    }
                    _context5.next = 3;
                    return executeCreation("S_{D".concat(divisionIndex, "} = Segment(").concat(previousPointLabel, ", ").concat(currentPointLabel, ")"));
                  case 3:
                    divisionSecantLabel = _context5.sent;
                    api.setLabelVisible(divisionSecantLabel, false), registerGroupMember(divisionSecantLabel, labelGroups.GROUP_DIVISION_SECANT);
                    patchLineStyleOpacity(divisionSecantLabel, 255);
                  case 6:
                    _context5.next = 8;
                    return executeCreation("s_{D".concat(divisionIndex, "} = (y(").concat(previousPointLabel, ") - y(").concat(currentPointLabel, ")) / (x(").concat(previousPointLabel, ") - x(").concat(currentPointLabel, "))"));
                  case 8:
                    secantSlopeLabel = _context5.sent;
                    _context5.next = 11;
                    return solveDerivativeAbscissaAndMakePoint("\u03BC_{".concat(divisionIndex, "}"), secantSlopeLabel, previousPointLabel, currentPointLabel);
                  case 11:
                    abscissaPointLabel = _context5.sent;
                    registerGroupMember(abscissaPointLabel, labelGroups.GROUP_MU_ABSCISSAS);
                    _context5.next = 15;
                    return makeTangentSegment("D".concat(divisionIndex), abscissaPointLabel, secantSlopeLabel, function (label) {
                      return registerGroupMember(label, labelGroups.GROUP_DIVISION_TANGENT);
                    });
                  case 15:
                    _context5.next = 17;
                    return executeCreation("F_{\u03BC".concat(divisionIndex, "} = (x(").concat(abscissaPointLabel, "), f'(x(").concat(abscissaPointLabel, ")))"));
                  case 17:
                    fPrimePointLabel = _context5.sent;
                    api.setLabelVisible(fPrimePointLabel, false);
                    registerGroupMember(fPrimePointLabel, labelGroups.GROUP_MU_ORDINATES);
                    _context5.next = 22;
                    return executeCreation("V_{\u03BC".concat(divisionIndex, "} = Segment(").concat(fPrimePointLabel, ", ").concat(abscissaPointLabel, ")"));
                  case 22:
                    fPrimeLineLabel = _context5.sent;
                    api.setLabelVisible(fPrimeLineLabel, false);
                    registerGroupMember(fPrimeLineLabel, labelGroups.GROUP_MU_ORDINATES);
                    patchLineStyleOpacity(fPrimeLineLabel, 255);
                    return _context5.abrupt("return", secantSlopeLabel);
                  case 27:
                  case "end":
                    return _context5.stop();
                }
              }, _callee4);
            }));
            return function setupDivisionAndGetSecantSlopeLabel(_x13, _x14, _x15, _x16) {
              return _ref5.apply(this, arguments);
            };
          }();
          setupQuadraturePolygonAndPossiblyMuSegment = /*#__PURE__*/function () {
            var _ref6 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee5(levelTermAbscissaPointLabel) {
              var derivativePointLabel, derivativeLineLabel, polygonPointAPrimeLabel, polygonPointBPrimeLabel, polygonLabel;
              return _regeneratorRuntime().wrap(function _callee5$(_context6) {
                while (1) switch (_context6.prev = _context6.next) {
                  case 0:
                    _context6.next = 2;
                    return executeCreation("L_{f'} = Point({x(".concat(levelTermAbscissaPointLabel, "), f'(x(").concat(levelTermAbscissaPointLabel, "))})"));
                  case 2:
                    derivativePointLabel = _context6.sent;
                    if (!(levelTermAbscissaPointLabel != "μ_1")) {
                      _context6.next = 14;
                      break;
                    }
                    registerGroupMember(derivativePointLabel, labelGroups.GROUP_LEVEL_TERM);
                    api.setLabelVisible(derivativePointLabel, false);
                    _context6.next = 8;
                    return executeCreation("V_{f'} = Segment(".concat(derivativePointLabel, ", ").concat(levelTermAbscissaPointLabel, ")"));
                  case 8:
                    derivativeLineLabel = _context6.sent;
                    registerGroupMember(derivativeLineLabel, labelGroups.GROUP_LEVEL_TERM);
                    api.setLabelVisible(derivativeLineLabel, false);
                    patchLineStyleOpacity(derivativeLineLabel, 255);
                    _context6.next = 15;
                    break;
                  case 14:
                    api.setVisible(derivativePointLabel, false);
                  case 15:
                    _context6.next = 17;
                    return executeCreation("Q_{A'} = Point({x(A), y(".concat(derivativePointLabel, ")})"));
                  case 17:
                    polygonPointAPrimeLabel = _context6.sent;
                    api.setVisible(polygonPointAPrimeLabel, false);
                    _context6.next = 21;
                    return executeCreation("Q_{B'} = Point({x(B), y(".concat(derivativePointLabel, ")})"));
                  case 21:
                    polygonPointBPrimeLabel = _context6.sent;
                    api.setVisible(polygonPointBPrimeLabel, false);
                    _context6.next = 25;
                    return executeCreation("Q_{f'} = Polygon(A, B, ".concat(polygonPointBPrimeLabel, ", ").concat(polygonPointAPrimeLabel, ")"), function (polygonVertexLabel) {
                      api.setLabelVisible(polygonVertexLabel, false);
                      api.setLayer(polygonVertexLabel, labelGroups.GROUP_QUADRATURE.layer);
                    });
                  case 25:
                    polygonLabel = _context6.sent;
                    api.setLabelVisible(polygonLabel, false);
                    api.setFilling(polygonLabel, .3);
                    registerGroupMember(polygonLabel, labelGroups.GROUP_QUADRATURE);
                    _context6.next = 31;
                    return createAttachedText(15, controlYOffset + 50, "A_{Qf'}", false, "\"Quadrature Area: \" + Q_{f'}", labelGroups.GROUP_QUADRATURE.labelTextColor, labelGroups.GROUP_QUADRATURE.color);
                  case 31:
                    _context6.next = 33;
                    return createAttachedText(15, controlYOffset + 80, "A_{If'}", false, "\"Irregular Area: \" + A_{f'}", labelGroups.GROUP_IRREGULAR.labelTextColor, labelGroups.GROUP_IRREGULAR.color);
                  case 33:
                  case "end":
                    return _context6.stop();
                }
              }, _callee5);
            }));
            return function setupQuadraturePolygonAndPossiblyMuSegment(_x17) {
              return _ref6.apply(this, arguments);
            };
          }();
          patchLineStyleOpacity = function patchLineStyleOpacity(objectLabel, value) {
            var xml = api.getXML(objectLabel);
            var tagMarker = '<lineStyle ';
            var tagMarkerBegin = xml.indexOf(tagMarker);
            var valueMarker = 'opacity="';
            var valueMarkerBegin = xml.indexOf(valueMarker, tagMarkerBegin + tagMarker.length);
            var valueEnd = xml.indexOf("\"", valueMarkerBegin + valueMarker.length);
            api.evalXML(xml.substring(0, valueMarkerBegin) + "opacity=\"".concat(value, "\"") + xml.substring(valueEnd + 1));
          };
          setupDivisions = /*#__PURE__*/function () {
            var _ref7 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee6(numberOfDivisions) {
              var secantSlopeLabels, previousPointLabel, firstPointLabel, i, abscissaLabel, divisionPointLabel, divisionLineLabel, intervalSecantLabel, slopeLevelTermLabel, levelTermAbscissaPointLabel;
              return _regeneratorRuntime().wrap(function _callee6$(_context7) {
                while (1) switch (_context7.prev = _context7.next) {
                  case 0:
                    secantSlopeLabels = [];
                    previousPointLabel = null;
                    firstPointLabel = null; // One more division, as the end of the last is the beginning of n+1
                    i = 1;
                  case 4:
                    if (!(i <= numberOfDivisions + 1)) {
                      _context7.next = 53;
                      break;
                    }
                    _context7.next = 7;
                    return executeCreation("x_{D".concat(i, "} = x_{AB}(").concat(i, ")"));
                  case 7:
                    abscissaLabel = _context7.sent;
                    _context7.next = 10;
                    return executeCreation("F_{D".concat(i, "} = (").concat(abscissaLabel, ", f(").concat(abscissaLabel, "))"));
                  case 10:
                    divisionPointLabel = _context7.sent;
                    registerGroupMember(divisionPointLabel, labelGroups.GROUP_DIVISION);
                    api.setLabelVisible(divisionPointLabel, false);
                    _context7.next = 15;
                    return executeCreation("V_{D".concat(i, "} = Segment((x(").concat(divisionPointLabel, "), 0), ").concat(divisionPointLabel, ")"));
                  case 15:
                    divisionLineLabel = _context7.sent;
                    registerGroupMember(divisionLineLabel, labelGroups.GROUP_DIVISION);
                    api.setLabelVisible(divisionLineLabel, false);
                    api.setLineThickness(divisionLineLabel, 12);
                    patchLineStyleOpacity(divisionLineLabel, 255);
                    if (!(previousPointLabel != null)) {
                      _context7.next = 26;
                      break;
                    }
                    _context7.t0 = secantSlopeLabels;
                    _context7.next = 24;
                    return setupDivisionAndGetSecantSlopeLabel(i - 1, numberOfDivisions, previousPointLabel, divisionPointLabel);
                  case 24:
                    _context7.t1 = _context7.sent;
                    _context7.t0.push.call(_context7.t0, _context7.t1);
                  case 26:
                    previousPointLabel = divisionPointLabel;
                    if (firstPointLabel == null) firstPointLabel = divisionPointLabel;
                    if (!(i == numberOfDivisions + 1)) {
                      _context7.next = 50;
                      break;
                    }
                    _context7.next = 31;
                    return executeCreation("S_I = Segment(".concat(firstPointLabel, ", ").concat(divisionPointLabel, ")"));
                  case 31:
                    intervalSecantLabel = _context7.sent;
                    registerGroupMember(intervalSecantLabel, labelGroups.GROUP_INTERVAL_SECANT);
                    api.setLabelVisible(intervalSecantLabel, false);
                    patchLineStyleOpacity(intervalSecantLabel, 255);
                    if (!(numberOfDivisions != 1)) {
                      _context7.next = 48;
                      break;
                    }
                    _context7.next = 38;
                    return executeCreation("s_G = (".concat(secantSlopeLabels.join("+"), ")/").concat(numberOfDivisions));
                  case 38:
                    slopeLevelTermLabel = _context7.sent;
                    _context7.next = 41;
                    return solveDerivativeAbscissaAndMakePoint("μ", slopeLevelTermLabel, "A", "B");
                  case 41:
                    levelTermAbscissaPointLabel = _context7.sent;
                    registerGroupMember(levelTermAbscissaPointLabel, labelGroups.GROUP_LEVEL_TERM);
                    _context7.next = 45;
                    return setupQuadraturePolygonAndPossiblyMuSegment(levelTermAbscissaPointLabel);
                  case 45:
                    _context7.next = 47;
                    return makeTangentSegment("G", levelTermAbscissaPointLabel, slopeLevelTermLabel, function (label) {
                      return registerGroupMember(label, labelGroups.GROUP_LEVEL_TERM_TANGENT);
                    });
                  case 47:
                    return _context7.abrupt("return");
                  case 48:
                    _context7.next = 50;
                    return setupQuadraturePolygonAndPossiblyMuSegment("μ_1");
                  case 50:
                    ++i;
                    _context7.next = 4;
                    break;
                  case 53:
                  case "end":
                    return _context7.stop();
                }
              }, _callee6);
            }));
            return function setupDivisions(_x18) {
              return _ref7.apply(this, arguments);
            };
          }();
          _context9.next = 22;
          return setupGroupCheckboxes();
        case 22:
          _context9.next = 24;
          return executeCreation("k = Slider(1, 6, 1)", null, true);
        case 24:
          sliderLabel = _context9.sent;
          api.setFixed(sliderLabel, true, true);
          controlYOffset += 50;
          api.evalCommand("SetCoords(".concat(sliderLabel, ", 25, ").concat(controlYOffset, ")"));
          previousSliderValue = api.getValue(sliderLabel);
          api.registerObjectUpdateListener(sliderLabel, /*#__PURE__*/_asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee7() {
            var currentSliderValue;
            return _regeneratorRuntime().wrap(function _callee7$(_context8) {
              while (1) switch (_context8.prev = _context8.next) {
                case 0:
                  currentSliderValue = api.getValue(sliderLabel); // Moving the object around causes update-calls too; only re-render on value changes
                  if (!(currentSliderValue != previousSliderValue)) {
                    _context8.next = 7;
                    break;
                  }
                  deleteTemporaryObjects();
                  clearAllGroupMembers();
                  _context8.next = 6;
                  return setupDivisions(currentSliderValue);
                case 6:
                  applyAllGroupCheckboxes();
                case 7:
                  previousSliderValue = currentSliderValue;
                case 8:
                case "end":
                  return _context8.stop();
              }
            }, _callee7);
          })));
          _context9.next = 32;
          return executeCreation("f(x) = 1/4 * x^3 + 1", null, true);
        case 32:
          fLabel = _context9.sent;
          registerGroupMember(fLabel, labelGroups.GROUP_FUNCTION, true);
          _context9.next = 36;
          return executeCreation("InputBox(".concat(fLabel, ")"), null, true);
        case 36:
          inputBoxLabel = _context9.sent;
          api.setFixed(inputBoxLabel, true, true);
          controlYOffset += 50;
          api.evalCommand("SetCoords(".concat(inputBoxLabel, ", 10, ").concat(controlYOffset, ")"));
          api.setCaption(inputBoxLabel, "$f(x)$");
          _context9.next = 43;
          return executeCreation("f'(x) = Derivative(".concat(fLabel, ")"), null, true);
        case 43:
          fPrimeLabel = _context9.sent;
          registerGroupMember(fPrimeLabel, labelGroups.GROUP_DERIVATIVE, true);

          // Constrain points to coincide with the x-axis (y=0, x=variable)
          _context9.next = 47;
          return executeCreation("a = -1", null, true);
        case 47:
          _context9.next = 49;
          return executeCreation("b = 1", null, true);
        case 49:
          _context9.next = 51;
          return executeCreation("A = (a, y(yAxis))", null, true);
        case 51:
          _context9.next = 53;
          return executeCreation("B = (b, y(yAxis))", null, true);
        case 53:
          registerGroupMember("A", labelGroups.GROUP_INTERVAL_BOUNDS, true);
          registerGroupMember("B", labelGroups.GROUP_INTERVAL_BOUNDS, true);
          _context9.next = 57;
          return executeCreation("A_{f'} = Integral(".concat(fPrimeLabel, ", x(A), x(B))"), null, true);
        case 57:
          derivativeAreaLabel = _context9.sent;
          api.setLabelVisible(derivativeAreaLabel, false);
          registerGroupMember(derivativeAreaLabel, labelGroups.GROUP_IRREGULAR, true);
          api.setFilling(derivativeAreaLabel, .3);
          _context9.next = 63;
          return executeCreation("x_{AB}(i) = x(A) + (x(B) - x(A))/".concat(sliderLabel, " * (i-1)"), null, true);
        case 63:
          beginningAbscissaLabel = _context9.sent;
          api.setVisible(beginningAbscissaLabel, false);

          // Setup based on the initial slider's value
          setupDivisions(api.getValue(sliderLabel));
        case 66:
        case "end":
          return _context9.stop();
      }
    }, _callee8);
  }));
  return function onAppletInit(_x) {
    return _ref.apply(this, arguments);
  };
}();
