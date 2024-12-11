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

  const labelGroups = {
    GROUP_FUNCTION:           { color: [  0, 208, 245], title: "Function",           temporaryMembers: [], permanentMembers: [] },
    GROUP_DERIVATIVE:         { color: [255,   0,   0], title: "Derivative",         temporaryMembers: [], permanentMembers: [] },
    GROUP_QUADRATURE:         { color: [  0, 255,   0], title: "Quadrature Area",    temporaryMembers: [], permanentMembers: [] },
    GROUP_IRREGULAR:          { color: [255,   0,   0], title: "Irregular Area",     temporaryMembers: [], permanentMembers: [] },
    GROUP_DIVISION:           { color: [245, 140,   0], title: "Division",           temporaryMembers: [], permanentMembers: [] },
    GROUP_DIVISION_SECANT:    { color: [  0,   0,   0], title: "Division Secant",    temporaryMembers: [], permanentMembers: [] },
    GROUP_INTERVAL_SECANT:    { color: [255,   0,   0], title: "Interval Secant",    temporaryMembers: [], permanentMembers: [] },
    GROUP_DIVISION_TANGENT:   { color: [255,   0, 255], title: "Division Tangent",   temporaryMembers: [], permanentMembers: [] },
    GROUP_LEVEL_TERM_TANGENT: { color: [128,   0, 255], title: "Level Term Tangent", temporaryMembers: [], permanentMembers: [] },
    GROUP_LEVEL_TERM:         { color: [128,   0, 255], title: "Level Term",         temporaryMembers: [], permanentMembers: [] },
    GROUP_MU_ABSCISSAS:       { color: [  0,   0,   0], title: "μ Abscissas",        temporaryMembers: [], permanentMembers: [] },
    GROUP_MU_ORDINATES:       { color: [  0,   0,   0], title: "μ Ordinates",        temporaryMembers: [], permanentMembers: [] },
  };

  const registerGroupMember = (label, group, permanent) => {
    api.setColor(label, group.color[0], group.color[1], group.color[2]);

    if (permanent === true)
      group.permanentMembers.push(label);
    else
      group.temporaryMembers.push(label);
  };

  const clearAllGroupMembers = () => {
    for (const groupKey in labelGroups)
      labelGroups[groupKey].temporaryMembers = [];
  };

  const setupGroupCheckboxes = async () => {
    let groupIndex = 0;

    for (const groupKey in labelGroups) {
      const labelGroup = labelGroups[groupKey];

      const checkboxLabel = await evaluateCommand(`b_g_{${++groupIndex}} = Checkbox()`, null, true);
      api.setCaption(checkboxLabel, labelGroup.title);
      api.setValue(checkboxLabel, 1);

      api.registerObjectUpdateListener(checkboxLabel, () => {
        const visibility = api.getValue(checkboxLabel) == 1;

        for (const temporaryMember of labelGroup.temporaryMembers)
          api.setVisible(temporaryMember, visibility);

        for (const permanentMember of labelGroup.permanentMembers)
          api.setVisible(permanentMember, visibility);
      });
    }
  };

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
    registerGroupMember(divisionSecantLabel, labelGroups.GROUP_DIVISION_SECANT);

    const secantSlopeLabel = await evaluateCommand(`s_{D${divisionIndex}} = (y(${previousPointLabel}) - y(${currentPointLabel})) / (x(${previousPointLabel}) - x(${currentPointLabel}))`);

    const abscissaPointLabel = await solveDerivativeAbscissaAndMakePoint(`μ_{${divisionIndex}}`, secantSlopeLabel, previousPointLabel, currentPointLabel);

    registerGroupMember(abscissaPointLabel, labelGroups.GROUP_MU_ABSCISSAS);

    await makeTangentSegment(
      `D${divisionIndex}`, abscissaPointLabel, secantSlopeLabel,
      label => registerGroupMember(label, labelGroups.GROUP_DIVISION_TANGENT)
    );

    const fPrimePointLabel = await evaluateCommand(`F_{μ${divisionIndex}} = (x(${abscissaPointLabel}), f'(x(${abscissaPointLabel})))`);

    api.setLabelVisible(fPrimePointLabel, false)
    registerGroupMember(fPrimePointLabel, labelGroups.GROUP_MU_ORDINATES);

    const fPrimeLineLabel = await evaluateCommand(`V_{μ${divisionIndex}} = Segment(${fPrimePointLabel}, ${abscissaPointLabel})`);

    api.setLabelVisible(fPrimeLineLabel, false)
    registerGroupMember(fPrimeLineLabel, labelGroups.GROUP_MU_ORDINATES);

    return secantSlopeLabel
  };

  const setupDivisions = async (numberOfDivisions) => {
    const secantSlopeLabels = [];

    let previousPointLabel = null;
    let firstPointLabel = null;
    let levelTermAbscissaPointLabel = null;

    // One more division, as the end of the last is the beginning of n+1
    for (let i = 1; i <= numberOfDivisions + 1; ++i) {
      const abscissaLabel = await evaluateCommand(`x_{D${i}} = x_{AB}(${i})`);

      const divisionPointLabel = await evaluateCommand(`F_{D${i}} = (${abscissaLabel}, f(${abscissaLabel}))`);

      registerGroupMember(divisionPointLabel, labelGroups.GROUP_DIVISION);
      api.setLabelVisible(divisionPointLabel, false)

      const divisionLineLabel = await evaluateCommand(`V_{D${i}} = Segment((x(${divisionPointLabel}), 0), ${divisionPointLabel})`);

      registerGroupMember(divisionLineLabel, labelGroups.GROUP_DIVISION);
      api.setLabelVisible(divisionLineLabel, false)

      if (previousPointLabel != null)
        secantSlopeLabels.push(await setupDivisionAndGetSecantSlopeLabel(i - 1, previousPointLabel, divisionPointLabel));

      previousPointLabel = divisionPointLabel;

      if (firstPointLabel == null)
        firstPointLabel = divisionPointLabel;

      if (numberOfDivisions != 1 && i == numberOfDivisions + 1) {
        const intervalSecantLabel = await evaluateCommand(`S_I = Segment(${firstPointLabel}, ${divisionPointLabel})`);

        registerGroupMember(intervalSecantLabel, labelGroups.GROUP_INTERVAL_SECANT);
        api.setLabelVisible(intervalSecantLabel, false);

        const slopeLevelTermLabel = await evaluateCommand(`s_G = (${secantSlopeLabels.join("+")})/${numberOfDivisions}`);

        levelTermAbscissaPointLabel = await solveDerivativeAbscissaAndMakePoint("μ", slopeLevelTermLabel, "A", "B");

        registerGroupMember(levelTermAbscissaPointLabel, labelGroups.GROUP_LEVEL_TERM);

        await makeTangentSegment(
          `G`, levelTermAbscissaPointLabel, slopeLevelTermLabel,
          label => registerGroupMember(label, labelGroups.GROUP_LEVEL_TERM_TANGENT)
        );
      }

      else
        levelTermAbscissaPointLabel = "μ_1";
    }

    const derivativePointLabel = await evaluateCommand(`L_{f'} = Point({x(${levelTermAbscissaPointLabel}), f'(x(${levelTermAbscissaPointLabel}))})`);

    if (levelTermAbscissaPointLabel != "μ_1") {
      registerGroupMember(derivativePointLabel, labelGroups.GROUP_LEVEL_TERM);
      api.setLabelVisible(derivativePointLabel, false);

      const derivativeLineLabel = await evaluateCommand(`V_{f'} = Segment(${derivativePointLabel}, ${levelTermAbscissaPointLabel})`);

      registerGroupMember(derivativeLineLabel, labelGroups.GROUP_LEVEL_TERM);
      api.setLabelVisible(derivativeLineLabel, false);
    }

    else
      api.setVisible(derivativePointLabel, false);

    const polygonPointAPrimeLabel = await evaluateCommand(`Q_{A'} = Point({x(A), y(${derivativePointLabel})})`);
    api.setVisible(polygonPointAPrimeLabel, false);

    const polygonPointBPrimeLabel = await evaluateCommand(`Q_{B'} = Point({x(B), y(${derivativePointLabel})})`);
    api.setVisible(polygonPointBPrimeLabel, false);

    const polygonLabel = await evaluateCommand(
      `Q_{f'} = Polygon(A, B, ${polygonPointBPrimeLabel}, ${polygonPointAPrimeLabel})`,
      polygonVertexLabel => api.setLabelVisible(polygonVertexLabel, false)
    );

    api.setLabelVisible(polygonLabel, false);
    api.setFilling(polygonLabel, .3);

    registerGroupMember(polygonLabel, labelGroups.GROUP_QUADRATURE);
  };

  // Number of equally sized divisions between A and B
  const sliderLabel = await evaluateCommand("k = Slider(1, 5, 1)", null, true);

  api.evalCommand(`SetCoords(${sliderLabel}, 25, 420)`);

  let previousSliderValue = api.getValue(sliderLabel);

  api.registerObjectUpdateListener(sliderLabel, () => {
    const currentSliderValue = api.getValue(sliderLabel);

    // Moving the object around causes update-calls too; only re-render on value changes
    if (currentSliderValue != previousSliderValue) {
      deleteTemporaryObjects();
      clearAllGroupMembers();
      setupDivisions(currentSliderValue);
    }

    previousSliderValue = currentSliderValue;
  });

  const fLabel = await evaluateCommand("f(x) = 1/4 * x^3 + 1", null, true);

  registerGroupMember(fLabel, labelGroups.GROUP_FUNCTION, true);

  api.registerObjectUpdateListener(fLabel, () => {
    deleteTemporaryObjects();
    clearAllGroupMembers();

    // Rebuild divisions only if the input-box successfully parsed a new expression for f
    if (api.isDefined(fLabel))
      setupDivisions(api.getValue(sliderLabel));
  });

  const inputBoxLabel = await evaluateCommand(`InputBox(${fLabel})`, null, true);

  api.evalCommand(`SetCoords(${inputBoxLabel}, 10, 470)`);
  api.setCaption(inputBoxLabel, "f(x)");

  const fPrimeLabel = await evaluateCommand(`f'(x) = Derivative(${fLabel})`, null, true);

  registerGroupMember(fPrimeLabel, labelGroups.GROUP_DERIVATIVE, true);

  // Constrain points to coincide with the x-axis (y=0, x=variable)
  await evaluateCommand("a = -1", null, true);
  await evaluateCommand("b = 1", null, true);
  await evaluateCommand(`A = (a, y(yAxis))`, null, true);
  await evaluateCommand(`B = (b, y(yAxis))`, null, true);

  const derivativeAreaLabel = await evaluateCommand(`A_{f'} = Integral(${fPrimeLabel}, x(A), x(B))`, null, true);

  api.setLabelVisible(derivativeAreaLabel, false);
  registerGroupMember(derivativeAreaLabel, labelGroups.GROUP_IRREGULAR, true);
  api.setFilling(derivativeAreaLabel, .3);

  const beginningAbscissaLabel = await evaluateCommand(`x_{AB}(i) = x(A) + (x(B) - x(A))/${sliderLabel} * (i-1)`, null, true);

  api.setVisible(beginningAbscissaLabel, false);

  setupGroupCheckboxes();

  // Setup based on the initial slider's value
  setupDivisions(api.getValue(sliderLabel));
}