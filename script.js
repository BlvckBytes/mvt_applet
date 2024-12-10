const onAppletInit = api => {
  let temporaryLabels = [];
  let unhandledAliveCallLabels = [];
  let aliveListenerByLabel = {};
  const tangentLength = .5;

  const registerTemporaryLabels = (labelString, aliveListener) => {
    const labels = labelString.split(',');

    for (const label of labels) {
      temporaryLabels.push(label);

      if (aliveListener) {
        if (unhandledAliveCallLabels.includes(label))
          aliveListener(label);
        else
          aliveListenerByLabel[label] = aliveListener;
      }
    }

    return labels[0]
  };

  const clearDivisions = (numberOfDivisions) => {
    aliveListenerByLabel = {};

    for (let i = temporaryLabels.length - 1; i >= 0; --i)
      api.deleteObject(temporaryLabels[i]);

    unhandledAliveCallLabels = [];
    temporaryLabels = [];
  };

  const solveDerivativeAbscissaAndMakePoint = (pointLabel, slopeValueLabel, minXValueLabel, maxXValueLabel) => {
    return registerTemporaryLabels(
      api.evalCommandGetLabels(
        `${pointLabel} = Point({Element(` +
          'KeepIf(' +
            `x >= x(${minXValueLabel}) && x <= x(${maxXValueLabel}),`+
            `NSolutions(f' = ${slopeValueLabel})` +
          ')' +
        ', 1), 0})'
      )
    );
  };

  const makeTangentSegment = (labelNamePart, abscissaPointLabel, slopeLabel, aliveListener) => {
    const tangentFunctionLabel = registerTemporaryLabels(
      api.evalCommandGetLabels(`t_{${labelNamePart}}(x) = ${slopeLabel} * (x - x(${abscissaPointLabel})) + f(x(${abscissaPointLabel}))`),
      label => api.setVisible(label, false)
    );

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
    */
    const segmentDeltaXLabel = registerTemporaryLabels(
      api.evalCommandGetLabels(`a_{${labelNamePart}} = sqrt(${tangentLength}^2 / (4*${slopeLabel}^2 + 4))`)
    );

    const sX = `x(${abscissaPointLabel}) - ${segmentDeltaXLabel}`;
    const eX = `x(${abscissaPointLabel}) + ${segmentDeltaXLabel}`;

    // I've tried to simply plot the function t(x) in [sX;eX], but got horrible lag - thus, let's instantiate a segment manually
    registerTemporaryLabels(
      api.evalCommandGetLabels(`t_s_{${labelNamePart}} = Segment((${sX}, ${tangentFunctionLabel}(${sX})), (${eX}, ${tangentFunctionLabel}(${eX})))`),
      label => {
        if (aliveListener)
          aliveListener(label)

        api.setLabelVisible(label, false);
      }
    );

    registerTemporaryLabels(
      api.evalCommandGetLabels(`T_{${labelNamePart}} = Point({x(${abscissaPointLabel}), f(x(${abscissaPointLabel}))})`),
      label => {
        if (aliveListener)
          aliveListener(label)

        api.setLabelVisible(label, false);
      }
    );
  };

  const setupDivision = (divisionIndex, previousPointLabel, currentPointLabel) => {
    registerTemporaryLabels(
      api.evalCommandGetLabels(`S_{D${divisionIndex}} = Segment(${previousPointLabel}, ${currentPointLabel})`),
      label => {
        api.setLabelVisible(label, false),
        api.setColor(label, 0, 0, 0);
      }
    );

    const secantSlopeLabel = registerTemporaryLabels(
      api.evalCommandGetLabels(`s_{D${divisionIndex}} = (y(${previousPointLabel}) - y(${currentPointLabel})) / (x(${previousPointLabel}) - x(${currentPointLabel}))`),
    );

    const abscissaPointLabel = solveDerivativeAbscissaAndMakePoint(`μ_{${divisionIndex}}`, secantSlopeLabel, previousPointLabel, currentPointLabel);

    makeTangentSegment(
      `D${divisionIndex}`, abscissaPointLabel, secantSlopeLabel,
      label => api.setColor(label, 255, 0, 255)
    );

    const fPrimePointLabel = registerTemporaryLabels(
      api.evalCommandGetLabels(`F_{μ${divisionIndex}} = (x(${abscissaPointLabel}), f'(x(${abscissaPointLabel})))`),
      label => api.setLabelVisible(label, false)
    );

    registerTemporaryLabels(
      api.evalCommandGetLabels(`V_{μ${divisionIndex}} = Segment(${fPrimePointLabel}, ${abscissaPointLabel})`),
      label => api.setLabelVisible(label, false)
    );
  };

  const setupDivisions = (numberOfDivisions) => {
    let previousPointLabel = null;
    let firstPointLabel = null;
    let abscissaPointLabel = null;

    // One more division, as the end of the last is the beginning of n+1
    for (let i = 1; i <= numberOfDivisions + 1; ++i) {
      const abscissaLabel = registerTemporaryLabels(
        api.evalCommandGetLabels(`x_{D${i}} = x_{AB}(${i})`)
      );

      const pointLabel = registerTemporaryLabels(
        api.evalCommandGetLabels(`F_{D${i}} = (${abscissaLabel}, f(${abscissaLabel}))`),
        label => api.setLabelVisible(label, false)
      );

      registerTemporaryLabels(
        api.evalCommandGetLabels(`V_{D${i}} = Segment((x(${pointLabel}), 0), ${pointLabel})`),
        label => api.setLabelVisible(label, false)
      );

      if (previousPointLabel != null)
        setupDivision(i - 1, previousPointLabel, pointLabel);

      previousPointLabel = pointLabel;

      if (firstPointLabel == null)
        firstPointLabel = pointLabel;

      if (numberOfDivisions != 1 && i == numberOfDivisions + 1) {
        registerTemporaryLabels(
          api.evalCommandGetLabels(`S_G = Segment(${firstPointLabel}, ${pointLabel})`),
          label => {
            api.setColor(label, 255, 0, 0);
            api.setLabelVisible(label, false);
          }
        );

        // secant slope labels are of pattern s_{D${divisionIndex}}
        // let s_l be their level magnitude

        const slopeValueLabels = [];

        for (let divisionIndex = 1; divisionIndex <= numberOfDivisions; ++divisionIndex)
          slopeValueLabels.push(`s_{D${divisionIndex}}`);

        const slopeLevelTermLabel = registerTemporaryLabels(
          api.evalCommandGetLabels(`s_G = (${slopeValueLabels.join("+")})/${numberOfDivisions}`)
        );

        abscissaPointLabel = solveDerivativeAbscissaAndMakePoint(
          "μ", slopeLevelTermLabel, "A", "B",
          label => api.setColor(label, 128, 0, 255)
        );

        makeTangentSegment(
          `G`, abscissaPointLabel, slopeLevelTermLabel,
          label => api.setColor(label, 128, 0, 255)
        );
      }

      else
        abscissaPointLabel = "μ_1";
    }

    const derivativePointLabel = registerTemporaryLabels(
      api.evalCommandGetLabels(`L_{f'} = Point({x(${abscissaPointLabel}), f'(x(${abscissaPointLabel}))})`),
      label => {
        api.setColor(label, 128, 0, 255);
        api.setLabelVisible(label, false);
      }
    );

    registerTemporaryLabels(
      api.evalCommandGetLabels(`V_{f'} = Segment(L_{f'}, ${abscissaPointLabel})`),
      label => {
        api.setColor(label, 128, 0, 255);
        api.setLabelVisible(label, false);
      }
    );

    // TODO: This could most definitely use some async-await de-nesting, ^^"

    registerTemporaryLabels(
      api.evalCommandGetLabels(`Q_{B'} = Point({x(B), y(${derivativePointLabel})})`),
      polygonPointBPrimeLabel => {
        api.setVisible(polygonPointBPrimeLabel, false);

        registerTemporaryLabels(
          api.evalCommandGetLabels(`Q_{A'} = Point({x(A), y(${derivativePointLabel})})`),
          polygonPointAPrimeLabel => {
            api.setVisible(polygonPointAPrimeLabel, false);

            registerTemporaryLabels(
              api.evalCommandGetLabels(`Q_{f'} = Polygon(A, B, ${polygonPointBPrimeLabel}, ${polygonPointAPrimeLabel})`),
              polygonMemberLabel => {
                if (polygonMemberLabel == "Q_{f'}") {
                  api.setLabelVisible(polygonMemberLabel, false);
                  api.setColor(polygonMemberLabel, 0, 255, 0);
                  api.setFilling(polygonMemberLabel, .3);
                  return;
                }

                api.setVisible(polygonMemberLabel, false);
              }
            )
          }
        );
      }
    );
  };

  const handleAliveListener = (name) => {
    const listener = aliveListenerByLabel[name];

    if (listener && typeof listener == 'function') {
      delete aliveListenerByLabel[name];
      listener(name);
      return;
    }


    unhandledAliveCallLabels.push(name);
  };

  // Not sure if re-introduced, deleted objects call "Add" again - encountered some odd behavior; better safe than sorry.
  api.registerAddListener(name => handleAliveListener(name));
  api.registerUpdateListener(name => handleAliveListener(name));

  // Number of equally sized divisions between A and B
  const sliderLabel = api.evalCommandGetLabels("k = Slider(1, 5, 1)");
  let previousSliderValue = api.getValue(sliderLabel);

  // Rebuild divisions if the number of divisions has changed
  api.registerObjectUpdateListener(sliderLabel, () => {
    const sliderValue = api.getValue(sliderLabel);
    clearDivisions(previousSliderValue);
    setupDivisions(sliderValue);
    previousSliderValue = sliderValue;
  });

  api.evalCommandGetLabels("f(x) = 1/4 * x^3 + 1");

  // Rebuild divisions if the input-box successfully parsed a new expression for f
  api.registerObjectUpdateListener("f", () => {
    const isValid = api.isDefined("f");

    clearDivisions(sliderValue);

    if (isValid)
      setupDivisions(sliderValue);
  });

  api.setCaption(
    api.evalCommandGetLabels("InputBox(f)"),
    "f(x)"
  );

  api.evalCommand("f'(x) = Derivative(f)");

  // Constrain points to coincide with the x-axis (y=0, x=variable)
  api.evalCommand("a = -1");
  api.evalCommand("b = 1");
  api.evalCommand("A = (a, y(yAxis))");
  api.evalCommand("B = (b, y(yAxis))");

  const derivativeAreaLabel = api.evalCommandGetLabels("A_{f'} = Integral(f', x(A), x(B))");
  api.setLabelVisible(derivativeAreaLabel, false);
  api.setColor(derivativeAreaLabel, 255, 0, 0);
  api.setFilling(derivativeAreaLabel, .3);

  // Beginning abscissa of the i-th's (1-based) division
  api.setVisible(
    api.evalCommandGetLabels(`x_{AB}(i) = x(A) + (x(B) - x(A))/${sliderLabel} * (i-1)`),
    false
  );

  // Setup based on the initial slider's value
  setupDivisions(previousSliderValue);
}