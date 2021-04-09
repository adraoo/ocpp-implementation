import { Action, Entity } from '../../../../types/Authorization';
import { HTTPAuthError, HTTPError } from '../../../../types/HTTPError';
import { NextFunction, Request, Response } from 'express';

import AppAuthError from '../../../../exception/AppAuthError';
import AppError from '../../../../exception/AppError';
import Asset from '../../../../types/Asset';
import AssetFactory from '../../../../integration/asset/AssetFactory';
import { AssetInErrorType } from '../../../../types/InError';
import AssetSecurity from './security/AssetSecurity';
import AssetStorage from '../../../../storage/mongodb/AssetStorage';
import AuthorizationService from './AuthorizationService';
import Authorizations from '../../../../authorization/Authorizations';
import Constants from '../../../../utils/Constants';
import ConsumptionStorage from '../../../../storage/mongodb/ConsumptionStorage';
import Logging from '../../../../utils/Logging';
import { ServerAction } from '../../../../types/Server';
import SiteArea from '../../../../types/SiteArea';
import SiteAreaStorage from '../../../../storage/mongodb/SiteAreaStorage';
import TenantComponents from '../../../../types/TenantComponents';
import Utils from '../../../../utils/Utils';
import UtilsService from './UtilsService';
import moment from 'moment';

const MODULE_NAME = 'AssetService';

export default class AssetService {

  public static async handleGetAssetConsumption(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.ASSET,
      Action.LIST, Entity.ASSETS, MODULE_NAME, 'handleGetAssetConsumption');
    // Filter
    const filteredRequest = AssetSecurity.filterAssetConsumptionRequest(req.query);
    UtilsService.assertIdIsProvided(action, filteredRequest.AssetID, MODULE_NAME,
      'handleGetAssetConsumption', req.user);
    // Check auth
    if (!Authorizations.canReadAsset(req.user)) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: req.user,
        action: Action.READ, entity: Entity.ASSET,
        module: MODULE_NAME, method: 'handleGetAsset',
        value: filteredRequest.AssetID
      });
    }
    // Get it
    const asset = await AssetStorage.getAsset(req.user.tenantID, filteredRequest.AssetID, {},
      [ 'id', 'name' ]
    );
    UtilsService.assertObjectExists(action, asset, `Asset ID '${filteredRequest.AssetID}' does not exist`,
      MODULE_NAME, 'handleGetAssetConsumption', req.user);
    // Check dates
    if (!filteredRequest.StartDate || !filteredRequest.EndDate) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Start date and end date must be provided',
        module: MODULE_NAME, method: 'handleGetAssetConsumption',
        user: req.user,
        action: action
      });
    }
    // Check dates order
    if (filteredRequest.StartDate && filteredRequest.EndDate &&
        moment(filteredRequest.StartDate).isAfter(moment(filteredRequest.EndDate))) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: `The requested start date '${filteredRequest.StartDate.toISOString()}' is after the end date '${filteredRequest.EndDate.toISOString()}' `,
        module: MODULE_NAME, method: 'handleGetAssetConsumption',
        user: req.user,
        action: action
      });
    }
    // Get the ConsumptionValues
    const consumptions = await ConsumptionStorage.getAssetConsumptions(req.user.tenantID, {
      assetID: filteredRequest.AssetID,
      startDate: filteredRequest.StartDate,
      endDate: filteredRequest.EndDate
    }, [ 'startedAt', 'instantWatts', 'instantAmps', 'limitWatts', 'limitAmps', 'endedAt', 'stateOfCharge' ]);
    // Assign
    asset.values = consumptions;
    // Return
    res.json(asset);
    next();
  }

  public static async handleCheckAssetConnection(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.ASSET,
      Action.CHECK_CONNECTION, Entity.ASSET, MODULE_NAME, 'handleCheckAssetConnection');
    // Filter request
    const filteredRequest = AssetSecurity.filterAssetRequestByID(req.query);
    // Get asset connection type
    const assetImpl = await AssetFactory.getAssetImpl(req.user.tenantID, filteredRequest);
    // Asset has unknown connection type
    if (!assetImpl) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Asset service is not configured',
        module: MODULE_NAME, method: 'handleCheckAssetConnection',
        action: action,
        user: req.user
      });
    }
    // Is authorized to check connection ?
    if (!Authorizations.canCheckAssetConnection(req.user)) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: req.user,
        action: Action.CHECK_CONNECTION, entity: Entity.ASSET,
        module: MODULE_NAME, method: 'handleCheckAssetConnection'
      });
    }
    try {
      // Check connection
      await assetImpl.checkConnection();
      // Success
      res.json(Object.assign({ connectionIsValid: true }, Constants.REST_RESPONSE_SUCCESS));
    } catch (error) {
      // KO
      await Logging.logError({
        tenantID: req.user.tenantID,
        user: req.user,
        module: MODULE_NAME, method: 'handleCheckAssetConnection',
        message: 'Asset connection failed',
        action: action,
        detailedMessages: { error: error.message, stack: error.stack }
      });
      // Create fail response
      res.json(Object.assign({ connectionIsValid: false }, Constants.REST_RESPONSE_SUCCESS));
    }
    next();
  }

  public static async handleRetrieveConsumption(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.ASSET,
      Action.RETRIEVE_CONSUMPTION, Entity.ASSET, MODULE_NAME, 'handleRetrieveConsumption');
    // Is authorized to check connection ?
    if (!Authorizations.canRetrieveAssetConsumption(req.user)) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: req.user,
        entity: Entity.ASSET, action: Action.RETRIEVE_CONSUMPTION,
        module: MODULE_NAME, method: 'handleRetrieveConsumption'
      });
    }
    // Filter request
    const assetID = AssetSecurity.filterAssetRequestByID(req.query);
    UtilsService.assertIdIsProvided(action, assetID, MODULE_NAME, 'handleRetrieveConsumption', req.user);
    // Get
    const asset = await AssetStorage.getAsset(req.user.tenantID, assetID);
    UtilsService.assertObjectExists(action, asset, `Asset ID '${assetID}' does not exist`,
      MODULE_NAME, 'handleRetrieveConsumption', req.user);
    // Dynamic asset ?
    if (!asset.dynamicAsset) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        module: MODULE_NAME, method: 'handleRetrieveConsumption',
        action: action,
        user: req.user,
        message: 'This Asset is not dynamic, no consumption can be retrieved',
        detailedMessages: { asset }
      });
    }
    // Get asset factory
    const assetImpl = await AssetFactory.getAssetImpl(req.user.tenantID, asset.connectionID);
    if (!assetImpl) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Asset service is not configured',
        module: MODULE_NAME, method: 'handleRetrieveConsumption',
        action: ServerAction.RETRIEVE_ASSET_CONSUMPTION
      });
    }
    // Retrieve consumption
    const consumptions = await assetImpl.retrieveConsumptions(asset, true);
    if (!Utils.isEmptyArray(consumptions)) {
      const consumption = consumptions[0];
      // Assign
      if (consumption) {
        asset.lastConsumption = consumption.lastConsumption;
        asset.currentConsumptionWh = consumption.currentConsumptionWh;
        asset.currentInstantAmps = consumption.currentInstantAmps;
        asset.currentInstantAmpsL1 = consumption.currentInstantAmpsL1;
        asset.currentInstantAmpsL2 = consumption.currentInstantAmpsL2;
        asset.currentInstantAmpsL3 = consumption.currentInstantAmpsL3;
        asset.currentInstantVolts = consumption.currentInstantVolts;
        asset.currentInstantVoltsL1 = consumption.currentInstantVoltsL1;
        asset.currentInstantVoltsL2 = consumption.currentInstantVoltsL2;
        asset.currentInstantVoltsL3 = consumption.currentInstantVoltsL3;
        asset.currentInstantWatts = consumption.currentInstantWatts;
        asset.currentInstantWattsL1 = consumption.currentInstantWattsL1;
        asset.currentInstantWattsL2 = consumption.currentInstantWattsL2;
        asset.currentInstantWattsL3 = consumption.currentInstantWattsL3;
        asset.currentStateOfCharge = consumption.currentStateOfCharge;
        // Save Asset
        await AssetStorage.saveAsset(req.user.tenantID, asset);
      }
    } else {
      // TODO: Return a specific HTTP code to tell the user that the consumption cannot be retrieved
    }
    // Ok
    res.json(Constants.REST_RESPONSE_SUCCESS);
    next();
  }

  public static async handleGetAssetsInError(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.ASSET,
      Action.LIST, Entity.ASSETS, MODULE_NAME, 'handleGetAssetsInError');
    // Check auth
    if (!Authorizations.canListAssetsInError(req.user)) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: req.user,
        action: Action.IN_ERROR, entity: Entity.ASSETS,
        module: MODULE_NAME, method: 'handleGetAssetsInError'
      });
    }
    // Filter
    const filteredRequest = AssetSecurity.filterAssetsRequest(req.query);
    // Build error type
    const errorType = (filteredRequest.ErrorType ? filteredRequest.ErrorType.split('|') : [AssetInErrorType.MISSING_SITE_AREA]);
    // Get the assets
    const assets = await AssetStorage.getAssetsInError(req.user.tenantID,
      {
        search: filteredRequest.Search,
        siteAreaIDs: (filteredRequest.SiteAreaID ? filteredRequest.SiteAreaID.split('|') : null),
        siteIDs: (filteredRequest.SiteID ? filteredRequest.SiteID.split('|') : null),
        errorType
      },
      { limit: filteredRequest.Limit,
        skip: filteredRequest.Skip,
        sort: filteredRequest.SortFields,
        onlyRecordCount: filteredRequest.OnlyRecordCount
      },
      [ 'id', 'name', 'errorCodeDetails', 'errorCode' ]
    );
    res.json(assets);
    next();
  }

  public static async handleDeleteAsset(action: ServerAction, req: Request, res: Response, next: NextFunction) {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.ASSET,
      Action.DELETE, Entity.ASSET, MODULE_NAME, 'handleDeleteAsset');
    // Filter
    const filteredRequest = AssetSecurity.filterAssetRequest(req.query);
    // Check Mandatory fields
    UtilsService.assertIdIsProvided(action, filteredRequest.ID, MODULE_NAME, 'handleDeleteAsset', req.user);
    // Check auth
    if (!Authorizations.canDeleteAsset(req.user)) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: req.user,
        action: Action.DELETE, entity: Entity.ASSET,
        module: MODULE_NAME, method: 'handleDeleteAsset',
        value: filteredRequest.ID
      });
    }
    // Get
    const asset = await AssetStorage.getAsset(req.user.tenantID, filteredRequest.ID,
      { withSiteArea: filteredRequest.WithSiteArea });
    // Found?
    UtilsService.assertObjectExists(action, asset, `Asset ID '${filteredRequest.ID}' does not exist`,
      MODULE_NAME, 'handleDeleteAsset', req.user);
    // Delete
    await AssetStorage.deleteAsset(req.user.tenantID, asset.id);
    // Log
    await Logging.logSecurityInfo({
      tenantID: req.user.tenantID,
      user: req.user,
      module: MODULE_NAME, method: 'handleDeleteAsset',
      message: `Asset '${asset.name}' has been deleted successfully`,
      action: action,
      detailedMessages: { asset }
    });
    // Ok
    res.json(Constants.REST_RESPONSE_SUCCESS);
    next();
  }

  public static async handleGetAsset(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.ASSET,
      Action.READ, Entity.ASSET, MODULE_NAME, 'handleGetAsset');
    // Filter
    const filteredRequest = AssetSecurity.filterAssetRequest(req.query);
    // ID is mandatory
    UtilsService.assertIdIsProvided(action, filteredRequest.ID, MODULE_NAME, 'handleGetAsset', req.user);
    // Check auth
    if (!Authorizations.canReadAsset(req.user)) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: req.user,
        action: Action.READ, entity: Entity.ASSET,
        module: MODULE_NAME, method: 'handleGetAsset',
        value: filteredRequest.ID
      });
    }
    // Get it
    const asset = await AssetStorage.getAsset(req.user.tenantID, filteredRequest.ID,
      { withSiteArea: filteredRequest.WithSiteArea });
    UtilsService.assertObjectExists(action, asset, `Asset ID '${filteredRequest.ID}' does not exist`,
      MODULE_NAME, 'handleGetAsset', req.user);
    res.json(asset);
    next();
  }

  public static async handleGetAssetImage(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Filter
    const filteredRequest = AssetSecurity.filterAssetImageRequest(req.query);
    UtilsService.assertIdIsProvided(action, filteredRequest.ID, MODULE_NAME, 'handleGetAssetImage', req.user);
    // Get it
    const assetImage = await AssetStorage.getAssetImage(filteredRequest.TenantID, filteredRequest.ID);
    // Return
    if (assetImage?.image) {
      let header = 'image';
      let encoding: BufferEncoding = 'base64';
      // Remove encoding header
      if (assetImage.image.startsWith('data:image/')) {
        header = assetImage.image.substring(5, assetImage.image.indexOf(';'));
        encoding = assetImage.image.substring(assetImage.image.indexOf(';') + 1, assetImage.image.indexOf(',')) as BufferEncoding;
        assetImage.image = assetImage.image.substring(assetImage.image.indexOf(',') + 1);
      }
      res.setHeader('content-type', header);
      res.send(assetImage.image ? Buffer.from(assetImage.image, encoding) : null);
    } else {
      res.send(null);
    }
    next();
  }

  public static async handleGetAssets(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.ASSET,
      Action.LIST, Entity.ASSETS, MODULE_NAME, 'handleGetAssets');
    // Check auth
    if (!Authorizations.canListAssets(req.user)) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: req.user,
        action: Action.LIST, entity: Entity.ASSETS,
        module: MODULE_NAME, method: 'handleGetAssets'
      });
    }
    // Filter
    const filteredRequest = AssetSecurity.filterAssetsRequest(req.query);
    // Get authorization filters
    const authorizationAssetsFilters = await AuthorizationService.checkAndGetAssetsAuthorizationFilters(
      req.tenant, req.user, filteredRequest);
    if (!authorizationAssetsFilters.authorized) {
      UtilsService.sendEmptyDataResult(res, next);
      return;
    }
    // Get the assets
    const assets = await AssetStorage.getAssets(req.user.tenantID,
      {
        search: filteredRequest.Search,
        siteAreaIDs: (filteredRequest.SiteAreaID ? filteredRequest.SiteAreaID.split('|') : null),
        siteIDs: (filteredRequest.SiteID ? filteredRequest.SiteID.split('|') : null),
        withSiteArea: filteredRequest.WithSiteArea,
        withNoSiteArea: filteredRequest.WithNoSiteArea,
        dynamicOnly: filteredRequest.DynamicOnly,
        ...authorizationAssetsFilters.filters
      },
      { limit: filteredRequest.Limit, skip: filteredRequest.Skip, sort: filteredRequest.SortFields, onlyRecordCount: filteredRequest.OnlyRecordCount },
      authorizationAssetsFilters.projectFields
    );
    res.json(assets);
    next();
  }

  public static async handleCreateAsset(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.ASSET,
      Action.CREATE, Entity.ASSET, MODULE_NAME, 'handleCreateAsset');
    // Check auth
    if (!Authorizations.canCreateAsset(req.user)) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: req.user,
        action: Action.CREATE, entity: Entity.ASSET,
        module: MODULE_NAME, method: 'handleCreateAsset'
      });
    }
    // Filter
    const filteredRequest = AssetSecurity.filterAssetCreateRequest(req.body);
    // Check Asset
    UtilsService.checkIfAssetValid(filteredRequest, req);
    // Check Site Area
    let siteArea: SiteArea = null;
    if (filteredRequest.siteAreaID) {
      siteArea = await SiteAreaStorage.getSiteArea(req.user.tenantID, filteredRequest.siteAreaID);
      UtilsService.assertObjectExists(action, siteArea, `Site Area ID '${filteredRequest.siteAreaID}' does not exist`,
        MODULE_NAME, 'handleCreateAsset', req.user);
    }
    // Create asset
    const newAsset: Asset = {
      name: filteredRequest.name,
      siteAreaID: filteredRequest.siteAreaID,
      siteID: siteArea ? siteArea.siteID : null,
      assetType: filteredRequest.assetType,
      excludeFromSmartCharging: filteredRequest.excludeFromSmartCharging,
      fluctuationPercent: filteredRequest.fluctuationPercent,
      staticValueWatt: filteredRequest.staticValueWatt,
      coordinates: filteredRequest.coordinates,
      image: filteredRequest.image,
      dynamicAsset: filteredRequest.dynamicAsset,
      connectionID: filteredRequest.connectionID,
      meterID: filteredRequest.meterID,
      createdBy: { id: req.user.id },
      createdOn: new Date()
    } as Asset;
    // Save
    newAsset.id = await AssetStorage.saveAsset(req.user.tenantID, newAsset);
    // Log
    await Logging.logSecurityInfo({
      tenantID: req.user.tenantID,
      user: req.user,
      module: MODULE_NAME, method: 'handleCreateAsset',
      message: `Asset '${newAsset.id}' has been created successfully`,
      action: action,
      detailedMessages: { asset: newAsset }
    });
    // Ok
    res.json(Object.assign({ id: newAsset.id }, Constants.REST_RESPONSE_SUCCESS));
    next();
  }

  public static async handleUpdateAsset(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.ASSET,
      Action.UPDATE, Entity.ASSET, MODULE_NAME, 'handleUpdateAsset');
    // Filter
    const filteredRequest = AssetSecurity.filterAssetUpdateRequest(req.body);
    // Check auth
    if (!Authorizations.canUpdateAsset(req.user)) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: req.user,
        entity: Entity.ASSET, action: Action.UPDATE,
        module: MODULE_NAME, method: 'handleUpdateAsset',
        value: filteredRequest.id
      });
    }
    // Check Site Area
    let siteArea: SiteArea = null;
    if (filteredRequest.siteAreaID) {
      siteArea = await SiteAreaStorage.getSiteArea(req.user.tenantID, filteredRequest.siteAreaID);
      UtilsService.assertObjectExists(action, siteArea, `Site Area ID '${filteredRequest.siteAreaID}' does not exist`,
        MODULE_NAME, 'handleUpdateAsset', req.user);
    }
    // Check email
    const asset = await AssetStorage.getAsset(req.user.tenantID, filteredRequest.id);
    // Check
    UtilsService.assertObjectExists(action, asset, `Site Area ID '${filteredRequest.id}' does not exist`,
      MODULE_NAME, 'handleUpdateAsset', req.user);
    // Check Mandatory fields
    UtilsService.checkIfAssetValid(filteredRequest, req);
    // Update
    asset.name = filteredRequest.name;
    asset.siteAreaID = filteredRequest.siteAreaID;
    asset.siteID = siteArea ? siteArea.siteID : null,
    asset.assetType = filteredRequest.assetType;
    asset.excludeFromSmartCharging = filteredRequest.excludeFromSmartCharging;
    asset.fluctuationPercent = filteredRequest.fluctuationPercent;
    asset.staticValueWatt = filteredRequest.staticValueWatt;
    asset.coordinates = filteredRequest.coordinates;
    asset.image = filteredRequest.image;
    asset.dynamicAsset = filteredRequest.dynamicAsset;
    asset.connectionID = filteredRequest.connectionID;
    asset.meterID = filteredRequest.meterID;
    asset.lastChangedBy = { 'id': req.user.id };
    asset.lastChangedOn = new Date();
    // Update Asset
    await AssetStorage.saveAsset(req.user.tenantID, asset);
    // Log
    await Logging.logSecurityInfo({
      tenantID: req.user.tenantID,
      user: req.user,
      module: MODULE_NAME, method: 'handleUpdateAsset',
      message: `Asset '${asset.name}' has been updated successfully`,
      action: action,
      detailedMessages: { asset }
    });
    // Ok
    res.json(Constants.REST_RESPONSE_SUCCESS);
    next();
  }
}
