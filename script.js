const onAppletInit = async (api) => {

  // ================================================================================
  // Helpers regarding synchronization and temporary label tracking
  // ================================================================================

  let temporaryLabels = [];
  let unhandledAliveCallLabels = [];
  let aliveListenerByLabel = {};

  const executeCreation = (command, secondaryAliveListener, isPermanent) => {
    return new Promise((resolve, reject) => {
      // Need to be able to tell apart main- from secondary labels
      if (command.indexOf('\n') >= 0) {
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

  // Will be inaccessible behind the top-left corner's undo/redo otherwise
  let controlYOffset = 80;
  let checkboxUpdateHandlers = [];

  const labelGroups = {
    GROUP_FUNCTION:           { layer: 0, color: "#00d8f5", labelTextColor: "#000000", title: "Function",            temporaryMembers: [], permanentMembers: [] },
    GROUP_DERIVATIVE:         { layer: 0, color: "#FF0000", labelTextColor: "#000000", title: "Derivative",          temporaryMembers: [], permanentMembers: [] },
    GROUP_QUADRATURE:         { layer: 3, color: "#00FF00", labelTextColor: "#000000", title: "Quadrature Area",     temporaryMembers: [], permanentMembers: [] },
    GROUP_IRREGULAR:          { layer: 2, color: "#FF0000", labelTextColor: "#000000", title: "Irregular Area",      temporaryMembers: [], permanentMembers: [] },
    GROUP_DIVISION:           { layer: 4, color: "#f8ba2a", labelTextColor: "#000000", title: "Column Dividers",     temporaryMembers: [], permanentMembers: [] },
    GROUP_DIVISION_SECANT:    { layer: 4, color: "#000000", labelTextColor: "#FFFFFF", title: "Division Secant",     temporaryMembers: [], permanentMembers: [] },
    GROUP_INTERVAL_SECANT:    { layer: 4, color: "#1e00ff", labelTextColor: "#FFFFFF", title: "Interval Secant",     temporaryMembers: [], permanentMembers: [] },
    GROUP_DIVISION_TANGENT:   { layer: 4, color: "#FF00FF", labelTextColor: "#FFFFFF", title: "Division Tangent",    temporaryMembers: [], permanentMembers: [] },
    GROUP_LEVEL_TERM_TANGENT: { layer: 4, color: "#8000FF", labelTextColor: "#FFFFFF", title: "Level Term Tangent",  temporaryMembers: [], permanentMembers: [] },
    GROUP_LEVEL_TERM:         { layer: 4, color: "#8000FF", labelTextColor: "#FFFFFF", title: "Level Term Ordinate", temporaryMembers: [], permanentMembers: [] },
    GROUP_MU_ABSCISSAS:       { layer: 4, color: "#FF00FF", labelTextColor: "#FFFFFF", title: "μ Abscissas",         temporaryMembers: [], permanentMembers: [] },
    GROUP_MU_ORDINATES:       { layer: 4, color: "#FF00FF", labelTextColor: "#FFFFFF", title: "μ Ordinates",         temporaryMembers: [], permanentMembers: [] },
    GROUP_INTERVAL_BOUNDS:    { layer: 5, color: "#000000", labelTextColor: "#FFFFFF", title: "Interval Bounds",     temporaryMembers: [], permanentMembers: [] },
  };

  const registerGroupMember = (label, group, permanent) => {
    api.evalCommand(`SetColor(${label}, "${group.color}")`);
    api.setLayer(label, group.layer);

    if (permanent === true)
      group.permanentMembers.push(label);
    else
      group.temporaryMembers.push(label);
  };

  const clearAllGroupMembers = () => {
    const groupKeys = Object.keys(labelGroups);
    for (let groupKeyIndex = 0; groupKeyIndex < groupKeys.length; ++groupKeyIndex)
      labelGroups[groupKeys[groupKeyIndex]].temporaryMembers = [];
  };

  const setupGroupCheckboxes = async () => {
    checkboxUpdateHandlers = [];

    const groupKeys = Object.keys(labelGroups);
    for (let groupKeyIndex = 0; groupKeyIndex < groupKeys.length; ++groupKeyIndex) {
      const labelGroup = labelGroups[groupKeys[groupKeyIndex]];

      const groupIndex = controlYOffset / 32;
      const groupOffset = controlYOffset;
      controlYOffset += 32;

      const checkboxLabel = await executeCreation(`b_g_{${groupIndex}} = Checkbox()`, null, true);
      api.setLabelVisible(checkboxLabel, false);
      api.setValue(checkboxLabel, 1);
      api.setLayer(checkboxLabel, 9);
      api.evalCommand(`SetCoords(${checkboxLabel}, 5, ${groupOffset})`);

      const positionExpression = `AttachCopyToView((1,1), 1, (1,1), (0,0), (45,${groupOffset} + 23), (0,0))`;
      const checkboxTextLabel = await executeCreation(`t_g_{${groupIndex}} = Text("${labelGroup.title}", ${positionExpression})`, null, true);
      api.evalCommand(`SetColor(${checkboxTextLabel}, "${labelGroup.labelTextColor}")`);
      api.evalCommand(`SetBackgroundColor(${checkboxTextLabel}, "${labelGroup.color}")`);
      api.setLayer(checkboxTextLabel, 9);
      api.setFixed(checkboxTextLabel, true, true);

      const updateHandler = () => {
        const visibility = api.getValue(checkboxLabel) == 1;

        for (let i = 0; i < labelGroup.temporaryMembers.length; ++i)
          api.setVisible(labelGroup.temporaryMembers[i], visibility);

        for (let i = 0; i < labelGroup.permanentMembers.length; ++i)
          api.setVisible(labelGroup.permanentMembers[i], visibility);
      };

      api.registerObjectUpdateListener(checkboxLabel, updateHandler);
      checkboxUpdateHandlers.push(updateHandler);
    }
  };

  const applyAllGroupCheckboxes = () => {
    for (let i = 0; i < checkboxUpdateHandlers.length; ++i)
      checkboxUpdateHandlers[i]();
  };

  const solveDerivativeAbscissaAndMakePoint = (pointLabel, slopeValueLabel, minXValueLabel, maxXValueLabel) => {
    return executeCreation(
      `${pointLabel} = Point({Element(` +
        'KeepIf(' +
          `x >= x(${minXValueLabel}) && x <= x(${maxXValueLabel}),`+
          `NSolutions(f' = ${slopeValueLabel})` +
        ')' +
      ', 1), 0})'
    );
  };

  const makeTangentSegment = async (labelNamePart, abscissaPointLabel, slopeLabel, pointAndSegmentLabelCallback) => {
    const tangentFunctionLabel = await executeCreation(`t_{${labelNamePart}}(x) = ${slopeLabel} * (x - x(${abscissaPointLabel})) + f(x(${abscissaPointLabel}))`);

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
    const tangentLength = .5;
    const segmentDeltaXLabel = await executeCreation(`a_{${labelNamePart}} = ${tangentLength} / sqrt((4*${slopeLabel}^2 + 4))`);

    const sX = `x(${abscissaPointLabel}) - ${segmentDeltaXLabel}`;
    const eX = `x(${abscissaPointLabel}) + ${segmentDeltaXLabel}`;

    // I've tried to simply plot the function t(x) in [sX;eX], but got horrible lag - thus, let's instantiate a segment manually
    const segmentLabel = await executeCreation(`t_s_{${labelNamePart}} = Segment((${sX}, ${tangentFunctionLabel}(${sX})), (${eX}, ${tangentFunctionLabel}(${eX})))`);

    api.setLabelVisible(segmentLabel, false);
    patchLineStyleOpacity(segmentLabel, 255);

    if (pointAndSegmentLabelCallback)
      pointAndSegmentLabelCallback(segmentLabel);

    const pointLabel = await executeCreation(`T_{${labelNamePart}} = Point({x(${abscissaPointLabel}), f(x(${abscissaPointLabel}))})`);

    api.setLabelVisible(pointLabel, false);

    if (pointAndSegmentLabelCallback)
      pointAndSegmentLabelCallback(pointLabel);
  };

  const setupDivisionAndGetSecantSlopeLabel = async (divisionIndex, numberOfDivisions, previousPointLabel, currentPointLabel) => {
    if (numberOfDivisions != 1) {
      const divisionSecantLabel = await executeCreation(`S_{D${divisionIndex}} = Segment(${previousPointLabel}, ${currentPointLabel})`);

      api.setLabelVisible(divisionSecantLabel, false),
      registerGroupMember(divisionSecantLabel, labelGroups.GROUP_DIVISION_SECANT);
      patchLineStyleOpacity(divisionSecantLabel, 255);
    }

    const secantSlopeLabel = await executeCreation(`s_{D${divisionIndex}} = (y(${previousPointLabel}) - y(${currentPointLabel})) / (x(${previousPointLabel}) - x(${currentPointLabel}))`);

    const abscissaPointLabel = await solveDerivativeAbscissaAndMakePoint(`μ_{${divisionIndex}}`, secantSlopeLabel, previousPointLabel, currentPointLabel);

    registerGroupMember(abscissaPointLabel, labelGroups.GROUP_MU_ABSCISSAS);

    await makeTangentSegment(
      `D${divisionIndex}`, abscissaPointLabel, secantSlopeLabel,
      label => registerGroupMember(label, labelGroups.GROUP_DIVISION_TANGENT)
    );

    const fPrimePointLabel = await executeCreation(`F_{μ${divisionIndex}} = (x(${abscissaPointLabel}), f'(x(${abscissaPointLabel})))`);

    api.setLabelVisible(fPrimePointLabel, false)
    registerGroupMember(fPrimePointLabel, labelGroups.GROUP_MU_ORDINATES);

    const fPrimeLineLabel = await executeCreation(`V_{μ${divisionIndex}} = Segment(${fPrimePointLabel}, ${abscissaPointLabel})`);

    api.setLabelVisible(fPrimeLineLabel, false)
    registerGroupMember(fPrimeLineLabel, labelGroups.GROUP_MU_ORDINATES);
    patchLineStyleOpacity(fPrimeLineLabel, 255);

    return secantSlopeLabel
  };

  const setupQuadraturePolygonAndPossiblyMuSegment = async (levelTermAbscissaPointLabel) => {
    const derivativePointLabel = await executeCreation(`L_{f'} = Point({x(${levelTermAbscissaPointLabel}), f'(x(${levelTermAbscissaPointLabel}))})`);

    if (levelTermAbscissaPointLabel != "μ_1") {
      registerGroupMember(derivativePointLabel, labelGroups.GROUP_LEVEL_TERM);
      api.setLabelVisible(derivativePointLabel, false);

      const derivativeLineLabel = await executeCreation(`V_{f'} = Segment(${derivativePointLabel}, ${levelTermAbscissaPointLabel})`);

      registerGroupMember(derivativeLineLabel, labelGroups.GROUP_LEVEL_TERM);
      api.setLabelVisible(derivativeLineLabel, false);
      patchLineStyleOpacity(derivativeLineLabel, 255);
    }

    else
      api.setVisible(derivativePointLabel, false);

    const polygonPointAPrimeLabel = await executeCreation(`Q_{A'} = Point({x(A), y(${derivativePointLabel})})`);
    api.setVisible(polygonPointAPrimeLabel, false);

    const polygonPointBPrimeLabel = await executeCreation(`Q_{B'} = Point({x(B), y(${derivativePointLabel})})`);
    api.setVisible(polygonPointBPrimeLabel, false);

    const polygonLabel = await executeCreation(
      `Q_{f'} = Polygon(A, B, ${polygonPointBPrimeLabel}, ${polygonPointAPrimeLabel})`,
      polygonVertexLabel => {
        api.setLabelVisible(polygonVertexLabel, false)
        api.setLayer(polygonVertexLabel, labelGroups.GROUP_QUADRATURE.layer);
      }
    );

    api.setLabelVisible(polygonLabel, false);
    api.setFilling(polygonLabel, .3);

    registerGroupMember(polygonLabel, labelGroups.GROUP_QUADRATURE);
  }

  const patchLineStyleOpacity = (objectLabel, value) => {
    const xml = api.getXML(objectLabel);
    const tagMarker = '<lineStyle ';
    const tagMarkerBegin = xml.indexOf(tagMarker);
    const valueMarker = 'opacity="';
    const valueMarkerBegin = xml.indexOf(valueMarker, tagMarkerBegin + tagMarker.length);
    const valueEnd = xml.indexOf("\"", valueMarkerBegin + valueMarker.length);
    api.evalXML(xml.substring(0, valueMarkerBegin) + `opacity="${value}"` + xml.substring(valueEnd + 1));
  };

  const setupDivisions = async (numberOfDivisions) => {
    const secantSlopeLabels = [];

    let previousPointLabel = null;
    let firstPointLabel = null;

    // One more division, as the end of the last is the beginning of n+1
    for (let i = 1; i <= numberOfDivisions + 1; ++i) {
      const abscissaLabel = await executeCreation(`x_{D${i}} = x_{AB}(${i})`);

      const divisionPointLabel = await executeCreation(`F_{D${i}} = (${abscissaLabel}, f(${abscissaLabel}))`);

      registerGroupMember(divisionPointLabel, labelGroups.GROUP_DIVISION);
      api.setLabelVisible(divisionPointLabel, false)

      const divisionLineLabel = await executeCreation(`V_{D${i}} = Segment((x(${divisionPointLabel}), 0), ${divisionPointLabel})`);

      registerGroupMember(divisionLineLabel, labelGroups.GROUP_DIVISION);
      api.setLabelVisible(divisionLineLabel, false);
      api.setLineThickness(divisionLineLabel, 12);
      patchLineStyleOpacity(divisionLineLabel, 255);

      if (previousPointLabel != null)
        secantSlopeLabels.push(await setupDivisionAndGetSecantSlopeLabel(i - 1, numberOfDivisions, previousPointLabel, divisionPointLabel));

      previousPointLabel = divisionPointLabel;

      if (firstPointLabel == null)
        firstPointLabel = divisionPointLabel;

      if (i == numberOfDivisions + 1) {
        const intervalSecantLabel = await executeCreation(`S_I = Segment(${firstPointLabel}, ${divisionPointLabel})`);

        registerGroupMember(intervalSecantLabel, labelGroups.GROUP_INTERVAL_SECANT);
        api.setLabelVisible(intervalSecantLabel, false);
        patchLineStyleOpacity(intervalSecantLabel, 255);

        if (numberOfDivisions != 1) {
          const slopeLevelTermLabel = await executeCreation(`s_G = (${secantSlopeLabels.join("+")})/${numberOfDivisions}`);

          const levelTermAbscissaPointLabel = await solveDerivativeAbscissaAndMakePoint("μ", slopeLevelTermLabel, "A", "B");
          registerGroupMember(levelTermAbscissaPointLabel, labelGroups.GROUP_LEVEL_TERM);

          await setupQuadraturePolygonAndPossiblyMuSegment(levelTermAbscissaPointLabel);

          await makeTangentSegment(
            `G`, levelTermAbscissaPointLabel, slopeLevelTermLabel,
            label => registerGroupMember(label, labelGroups.GROUP_LEVEL_TERM_TANGENT)
          );

          return;
        }

        await setupQuadraturePolygonAndPossiblyMuSegment("μ_1");
      }
    }
  };

  await setupGroupCheckboxes();

  // Number of equally sized divisions between A and B
  const sliderLabel = await executeCreation("k = Slider(1, 6, 1)", null, true);

  api.setFixed(sliderLabel, true, true);

  controlYOffset += 50;

  api.evalCommand(`SetCoords(${sliderLabel}, 25, ${controlYOffset})`);

  let previousSliderValue = api.getValue(sliderLabel);

  api.registerObjectUpdateListener(sliderLabel, async () => {
    const currentSliderValue = api.getValue(sliderLabel);

    // Moving the object around causes update-calls too; only re-render on value changes
    if (currentSliderValue != previousSliderValue) {
      deleteTemporaryObjects();
      clearAllGroupMembers();

      await setupDivisions(currentSliderValue);
      applyAllGroupCheckboxes();
    }

    previousSliderValue = currentSliderValue;
  });

  const fLabel = await executeCreation("f(x) = 1/4 * x^3 + 1", null, true);

  registerGroupMember(fLabel, labelGroups.GROUP_FUNCTION, true);

  const inputBoxLabel = await executeCreation(`InputBox(${fLabel})`, null, true);

  api.setFixed(inputBoxLabel, true, true);

  controlYOffset += 50;

  api.evalCommand(`SetCoords(${inputBoxLabel}, 10, ${controlYOffset})`);
  api.setCaption(inputBoxLabel, "f(x)");

  const fPrimeLabel = await executeCreation(`f'(x) = Derivative(${fLabel})`, null, true);

  registerGroupMember(fPrimeLabel, labelGroups.GROUP_DERIVATIVE, true);

  // Constrain points to coincide with the x-axis (y=0, x=variable)
  await executeCreation("a = -1", null, true);
  await executeCreation("b = 1", null, true);
  await executeCreation(`A = (a, y(yAxis))`, null, true);
  await executeCreation(`B = (b, y(yAxis))`, null, true);

  registerGroupMember("A", labelGroups.GROUP_INTERVAL_BOUNDS, true);
  registerGroupMember("B", labelGroups.GROUP_INTERVAL_BOUNDS, true);

  const derivativeAreaLabel = await executeCreation(`A_{f'} = Integral(${fPrimeLabel}, x(A), x(B))`, null, true);

  api.setLabelVisible(derivativeAreaLabel, false);
  registerGroupMember(derivativeAreaLabel, labelGroups.GROUP_IRREGULAR, true);
  api.setFilling(derivativeAreaLabel, .3);

  const beginningAbscissaLabel = await executeCreation(`x_{AB}(i) = x(A) + (x(B) - x(A))/${sliderLabel} * (i-1)`, null, true);

  api.setVisible(beginningAbscissaLabel, false);

  // Setup based on the initial slider's value
  setupDivisions(api.getValue(sliderLabel));
}