const onAppletInit = async (api) => {

  // ================================================================================
  // Helpers regarding synchronization and temporary label tracking
  // ================================================================================

  let temporaryLabels = [];
  let unhandledAliveCallLabels = [];
  let aliveListenerByLabel = {};

  const evaluateCommand = (command, secondaryAliveListener, isPermanent) => {
    return new Promise((resolve, reject) => {
      // Need to be able to tell apart main- from secondary labels
      if (command.includes('\n')) {
        reject(`Encountered illegal command-count greater than one in command-string "${command}"`);
        return;
      }

      const evaluationResult = api.evalCommandGetLabels(command);

      if (typeof evaluationResult !== "string") {
        reject(`Failed at executing command "${command}"`);
        return;
      }

      const createdLabels = evaluationResult.split(',');

      // There's no reason to use this helper for non-creational commands
      if (createdLabels.length == 0) {
        reject(`Expected the command "${command} to create at least one object"`);
        return;
      }

      const mainLabel = createdLabels[0];

      if (isPermanent !== true)
        temporaryLabels.push(mainLabel);

      if (typeof secondaryAliveListener === 'function') {
        for (let i = 1; i < mainLabel.length; ++i) {
          const secondaryLabel = createdLabels[i];

          if (isPermanent !== true)
            temporaryLabels.push(secondaryLabel);

          if (unhandledAliveCallLabels.includes(secondaryLabel)) {
            secondaryAliveListener(secondaryLabel);
            continue;
          }

          aliveListenerByLabel[secondaryLabel] = secondaryAliveListener;
        }
      }

      if (unhandledAliveCallLabels.includes(mainLabel)) {
        resolve(mainLabel);
        return;
      }

      aliveListenerByLabel[mainLabel] = () => resolve(mainLabel);
    });
  };

  const deleteTemporaryObjects = () => {
    aliveListenerByLabel = {};

    for (let i = temporaryLabels.length - 1; i >= 0; --i)
      api.deleteObject(temporaryLabels[i]);

    unhandledAliveCallLabels = [];
    temporaryLabels = [];
  };

  api.registerAddListener(addedLabel => {
    const listener = aliveListenerByLabel[addedLabel];

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

  const solveDerivativeAbscissaAndMakePoint = (pointLabel, slopeValueLabel, minXValueLabel, maxXValueLabel) => {
    return evaluateCommand(
      `${pointLabel} = Point({Element(` +
        'KeepIf(' +
          `x >= x(${minXValueLabel}) && x <= x(${maxXValueLabel}),`+
          `NSolutions(f' = ${slopeValueLabel})` +
        ')' +
      ', 1), 0})'
    );
  };

  const makeTangentSegment = async (labelNamePart, abscissaPointLabel, slopeLabel, pointAndSegmentLabelCallback) => {
    const tangentFunctionLabel = await evaluateCommand(`t_{${labelNamePart}}(x) = ${slopeLabel} * (x - x(${abscissaPointLabel})) + f(x(${abscissaPointLabel}))`);

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
    */
    const tangentLength = .5;
    const segmentDeltaXLabel = await evaluateCommand(`a_{${labelNamePart}} = sqrt(${tangentLength}^2 / (4*${slopeLabel}^2 + 4))`);

    const sX = `x(${abscissaPointLabel}) - ${segmentDeltaXLabel}`;
    const eX = `x(${abscissaPointLabel}) + ${segmentDeltaXLabel}`;

    // I've tried to simply plot the function t(x) in [sX;eX], but got horrible lag - thus, let's instantiate a segment manually
    const segmentLabel = await evaluateCommand(`t_s_{${labelNamePart}} = Segment((${sX}, ${tangentFunctionLabel}(${sX})), (${eX}, ${tangentFunctionLabel}(${eX})))`);

    api.setLabelVisible(segmentLabel, false);

    if (pointAndSegmentLabelCallback)
      pointAndSegmentLabelCallback(segmentLabel);

    const pointLabel = await evaluateCommand(`T_{${labelNamePart}} = Point({x(${abscissaPointLabel}), f(x(${abscissaPointLabel}))})`);

    api.setLabelVisible(pointLabel, false);

    if (pointAndSegmentLabelCallback)
      pointAndSegmentLabelCallback(pointLabel);
  };

  const setupDivisionAndGetSecantSlopeLabel = async (divisionIndex, previousPointLabel, currentPointLabel) => {
    const divisionSecantLabel = await evaluateCommand(`S_{D${divisionIndex}} = Segment(${previousPointLabel}, ${currentPointLabel})`);

    api.setLabelVisible(divisionSecantLabel, false),
    api.setColor(divisionSecantLabel, 0, 0, 0);

    const secantSlopeLabel = await evaluateCommand(`s_{D${divisionIndex}} = (y(${previousPointLabel}) - y(${currentPointLabel})) / (x(${previousPointLabel}) - x(${currentPointLabel}))`);

    const abscissaPointLabel = await solveDerivativeAbscissaAndMakePoint(`μ_{${divisionIndex}}`, secantSlopeLabel, previousPointLabel, currentPointLabel);

    await makeTangentSegment(
      `D${divisionIndex}`, abscissaPointLabel, secantSlopeLabel,
      label => api.setColor(label, 255, 0, 255)
    );

    const fPrimePointLabel = await evaluateCommand(`F_{μ${divisionIndex}} = (x(${abscissaPointLabel}), f'(x(${abscissaPointLabel})))`);

    api.setLabelVisible(fPrimePointLabel, false)

    const fPrimeLineLabel = await evaluateCommand(`V_{μ${divisionIndex}} = Segment(${fPrimePointLabel}, ${abscissaPointLabel})`);

    api.setLabelVisible(fPrimeLineLabel, false)

    return secantSlopeLabel
  };

  const setupDivisions = async (numberOfDivisions) => {
    const secantSlopeLabels = [];

    let previousPointLabel = null;
    let firstPointLabel = null;
    let abscissaPointLabel = null;

    // One more division, as the end of the last is the beginning of n+1
    for (let i = 1; i <= numberOfDivisions + 1; ++i) {
      const abscissaLabel = await evaluateCommand(`x_{D${i}} = x_{AB}(${i})`);

      const pointLabel = await evaluateCommand(`F_{D${i}} = (${abscissaLabel}, f(${abscissaLabel}))`);
      api.setLabelVisible(pointLabel, false)

      const lineLabel = await evaluateCommand(`V_{D${i}} = Segment((x(${pointLabel}), 0), ${pointLabel})`);
      api.setLabelVisible(lineLabel, false)

      if (previousPointLabel != null)
        secantSlopeLabels.push(await setupDivisionAndGetSecantSlopeLabel(i - 1, previousPointLabel, pointLabel));

      previousPointLabel = pointLabel;

      if (firstPointLabel == null)
        firstPointLabel = pointLabel;

      if (numberOfDivisions != 1 && i == numberOfDivisions + 1) {
        const globalSecantLabel = await evaluateCommand(`S_G = Segment(${firstPointLabel}, ${pointLabel})`);

        api.setColor(globalSecantLabel, 255, 0, 0);
        api.setLabelVisible(globalSecantLabel, false);

        const slopeLevelTermLabel = await evaluateCommand(`s_G = (${secantSlopeLabels.join("+")})/${numberOfDivisions}`);

        abscissaPointLabel = await solveDerivativeAbscissaAndMakePoint(
          "μ", slopeLevelTermLabel, "A", "B",
          label => api.setColor(label, 128, 0, 255)
        );

        await makeTangentSegment(
          `G`, abscissaPointLabel, slopeLevelTermLabel,
          label => api.setColor(label, 128, 0, 255)
        );
      }

      else
        abscissaPointLabel = "μ_1";
    }

    const derivativePointLabel = await evaluateCommand(`L_{f'} = Point({x(${abscissaPointLabel}), f'(x(${abscissaPointLabel}))})`);

    api.setColor(derivativePointLabel, 128, 0, 255);
    api.setLabelVisible(derivativePointLabel, false);

    const derivativeLineLabel = await evaluateCommand(`V_{f'} = Segment(${derivativePointLabel}, ${abscissaPointLabel})`);

    api.setColor(derivativeLineLabel, 128, 0, 255);
    api.setLabelVisible(derivativeLineLabel, false);

    const polygonPointAPrimeLabel = await evaluateCommand(`Q_{A'} = Point({x(A), y(${derivativePointLabel})})`);
    api.setVisible(polygonPointAPrimeLabel, false);

    const polygonPointBPrimeLabel = await evaluateCommand(`Q_{B'} = Point({x(B), y(${derivativePointLabel})})`);
    api.setVisible(polygonPointBPrimeLabel, false);

    const polygonLabel = await evaluateCommand(
      `Q_{f'} = Polygon(A, B, ${polygonPointBPrimeLabel}, ${polygonPointAPrimeLabel})`,
      polygonVertexLabel => api.setVisible(polygonVertexLabel, false)
    );

    api.setLabelVisible(polygonLabel, false);
    api.setColor(polygonLabel, 0, 255, 0);
    api.setFilling(polygonLabel, .3);
  };

  // Number of equally sized divisions between A and B
  const sliderLabel = await evaluateCommand("k = Slider(1, 5, 1)", null, true);

  api.registerObjectUpdateListener(sliderLabel, () => {
    deleteTemporaryObjects();
    setupDivisions(api.getValue(sliderLabel));
  });

  const fLabel = await evaluateCommand("f(x) = 1/4 * x^3 + 1", null, true);

  api.registerObjectUpdateListener(fLabel, () => {
    deleteTemporaryObjects();

    // Rebuild divisions only if the input-box successfully parsed a new expression for f
    if (api.isDefined(fLabel))
      setupDivisions(api.getValue(sliderLabel));
  });

  const inputBoxLabel = await evaluateCommand(`InputBox(${fLabel})`, null, true);
  api.setCaption(inputBoxLabel, "f(x)");

  const fPrimeLabel = await evaluateCommand(`f'(x) = Derivative(${fLabel})`, null, true);

  // Constrain points to coincide with the x-axis (y=0, x=variable)
  await evaluateCommand("a = -1", null, true);
  await evaluateCommand("b = 1", null, true);
  await evaluateCommand(`A = (a, y(yAxis))`, null, true);
  await evaluateCommand(`B = (b, y(yAxis))`, null, true);

  const derivativeAreaLabel = await evaluateCommand(`A_{f'} = Integral(${fPrimeLabel}, x(A), x(B))`, null, true);

  api.setLabelVisible(derivativeAreaLabel, false);
  api.setColor(derivativeAreaLabel, 255, 0, 0);
  api.setFilling(derivativeAreaLabel, .3);

  const beginningAbscissaLabel = await evaluateCommand(`x_{AB}(i) = x(A) + (x(B) - x(A))/${sliderLabel} * (i-1)`, null, true);

  api.setVisible(beginningAbscissaLabel, false);

  // Setup based on the initial slider's value
  setupDivisions(api.getValue(sliderLabel));
}