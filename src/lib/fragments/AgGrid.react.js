import React, {Component} from 'react';
import PropTypes from 'prop-types';
import * as evaluate from 'static-eval';
import * as esprima from 'esprima';
import {omit, equals, isEmpty} from 'ramda';
import {propTypes as _propTypes, defaultProps as _defaultProps} from '../components/AgGrid.react';
import {expressWarn, gridFunctions, columnFunctions, replaceFunctions} from '../utils/functionVars';
import debounce from '../utils/debounce';

import MarkdownRenderer from '../renderers/markdownRenderer';
import RowMenuRenderer from '../renderers/rowMenuRenderer';
import {customFunctions} from '../renderers/customFunctions';

import 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';

import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import 'ag-grid-community/styles/ag-theme-balham.css';
import 'ag-grid-community/styles/ag-theme-material.css';

// d3 imports
import * as d3Format from "d3-format"
import * as d3Time from "d3-time"
import * as d3TimeFormat from "d3-time-format"
import * as d3Array from "d3-array"
const d3 = {...d3Format, ...d3Time, ...d3TimeFormat, ...d3Array};

// Rate-limit for resizing columns when table div is resized
const RESIZE_DEBOUNCE_MS = 200;

const XSSMESSAGE = 'you are trying to use a dangerous element that could lead to XSS';

export default class DashAgGrid extends Component {
    constructor(props) {
        super(props);

        const customComponents = window.dashAgGridComponentFunctions || {};
        const _this = this;
        Object.keys(customComponents).forEach(function(key) {
            if (typeof customComponents[key] !== 'function') {
                customComponents[key] = _this.generateRenderer(JSON.parse(JSON.stringify(customComponents[key])))
            }
        })

        this.state = {
            ...this.props.parentState,
            components: {
                rowMenu: this.generateRenderer(RowMenuRenderer),
                markdown: this.generateRenderer(MarkdownRenderer),
                ...customComponents
            }
        };


        this.onGridReady = this.onGridReady.bind(this);
        this.onSelectionChanged = this.onSelectionChanged.bind(this);
        this.onCellClicked = this.onCellClicked.bind(this);
        this.onCellValueChanged = this.onCellValueChanged.bind(this);
        this.onRowDataUpdated = this.onRowDataUpdated.bind(this);
        this.onFilterChanged = this.onFilterChanged.bind(this);
        this.onSortChanged = this.onSortChanged.bind(this);
        this.onRowGroupOpened = this.onRowGroupOpened.bind(this);
        this.onDisplayedColumnsChanged = this.onDisplayedColumnsChanged.bind(
            this
        );
        this.onGridSizeChanged = this.onGridSizeChanged.bind(this);
        this.updateColumnWidths = this.updateColumnWidths.bind(this);
        this.handleDynamicCellStyle = this.handleDynamicCellStyle.bind(this);
        this.handleDynamicRowStyle = this.handleDynamicRowStyle.bind(this);
        this.generateRenderer = this.generateRenderer.bind(this);
        this.resetColumnState = this.resetColumnState.bind(this);
        this.exportDataAsCsv = this.exportDataAsCsv.bind(this);
        this.setSelection = this.setSelection.bind(this);
        this.parseParamFunction = this.parseParamFunction.bind(this);
        this.buildArray = this.buildArray.bind(this);
        this.fixCols = this.fixCols.bind(this);

        // Additional Exposure
        this.setUpCols = this.setUpCols.bind(this);
        this.selectAll = this.selectAll.bind(this);
        this.selectAllFiltered = this.selectAllFiltered.bind(this);
        this.deselectAll = this.deselectAll.bind(this);
        this.autoSizeAllColumns = this.autoSizeAllColumns.bind(this);
        this.updateColumnState = this.updateColumnState.bind(this);
        this.deleteSelectedRows = this.deleteSelectedRows.bind(this);
        this.rowTransaction = this.rowTransaction.bind(this);
        this.getRowData = this.getRowData.bind(this);

        this.selectionEventFired = false;

    }

    setSelection(selection) {
        if (this.state.gridApi && selection) {
            if (!selection.length) {
                this.state.gridApi.deselectAll();
            } else {
                this.state.gridApi.forEachNode((node) => {
                    const isSelected = selection.some(equals(node.data));
                    node.setSelected(isSelected);
                });
            }
        }
    }

    fixCols(columnDef) {
        const {dangerously_allow_code} = this.props;

        const test = (target) => {
            if (target in columnDef) {
                if (!dangerously_allow_code && expressWarn.includes(target)) {
                    if (typeof columnDef[target] !== 'function') {
                        if (!(Object.keys(columnDef[target]).includes('function'))) {
                            columnDef[target] = () => '';
                            console.error({field: columnDef.field || columnDef.headerName, message: XSSMESSAGE})
                        }
                    }
                }
                if (typeof columnDef[target] !== 'function') {
                    if (Object.keys(columnDef[target]).includes('function') && !replaceFunctions.includes(target)) {
                        const newFunc = JSON.parse(JSON.stringify(columnDef[target].function))
                        columnDef[target] = (params) => this.parseParamFunction(params, newFunc)
                    }
                }
                if (replaceFunctions.includes(target)) {
                    for (const [key, value] of Object.entries(columnDef[target])) {
                        if (typeof value !== 'function') {
                            columnDef[target][key] = (params) => this.parseParamFunction(params, value)
                        }
                    }
                }
            }
        }

        if ("headerComponentParams" in columnDef) {
            if ('template' in columnDef.headerComponentParams && !dangerously_allow_code) {
                columnDef.headerComponentParams.template = '<div></div>'
                console.error({field: columnDef.field, message: XSSMESSAGE})
            }
        }

        columnFunctions.concat(expressWarn).map(test)

        return columnDef;
    }

    setUpCols(cellStyle) {
        const {columnDefs, setProps, defaultColDef} = this.props

        const cleanOneCol = (col) => {
            const colOut = this.fixCols(col);

            if ('cellStyle' in colOut) {
                return colOut;
            }
            return {
                ...omit(['id'], colOut),
                cellStyle: (params) => this.handleDynamicCellStyle({params, cellStyle}),
            };
        };

        if (columnDefs) {
            setProps({
                columnDefs: columnDefs.map((columnDef) => {
                    let colDefOut = columnDef;
                    if ('children' in columnDef) {
                        colDefOut = {
                            ...columnDef,
                            children: columnDef.children.map(cleanOneCol)
                        };
                    }

                    return cleanOneCol(colDefOut);
                })
            });
        }
        if (defaultColDef) {
            setProps({
                defaultColDef: cleanOneCol(defaultColDef)
            })
        }
    }

    onFilterChanged() {
        const {setProps, rowModelType} = this.props;
        if (rowModelType === 'clientSide') {
            const virtualRowData = [];
            this.state.gridApi.forEachNodeAfterFilter((node) => {
                virtualRowData.push(node.data);
            });

            const filterModel = this.state.gridApi.getFilterModel();
            this.setState({filterModel});
            setProps({virtualRowData});
        }
    }

    getRowData() {
        const newRowData = [];
        this.state.gridApi.forEachNode((node) => {
            newRowData.push(node.data);
        })
        return newRowData;
    }

    onSortChanged() {
        const {setProps} = this.props;
        const virtualRowData = [];
        this.state.gridApi.forEachNodeAfterFilterAndSort((node) => {
            virtualRowData.push(node.data);
        });

        setProps({
            virtualRowData: virtualRowData,
            columnState: this.state.gridColumnApi.getColumnState(),
        });
    }

    shouldComponentUpdate(nextProps) {
        if (JSON.stringify(nextProps) === JSON.stringify(this.props)) {
            return false;
        }
        return true;
    }

    componentDidMount() {
        this.setState({mounted: true});
    }

    componentDidUpdate(prevProps) {
        const {
            selectedRows,
            getDetailResponse,
            detailCellRendererParams,
            masterDetail,
            setProps,
            cellStyle,
            dashGridOptions,
            columnSize,
        } = this.props;

        if (this.props.rowModelType === 'infinite' &&
            this.props.clearInfiniteRows &&
            this.props.clearInfiniteRows !== prevProps.clearInfiniteRows) {
            // Clear rows by setting data source.
            this.state.gridApi.setDatasource(this.getDatasource());
            this.props.setProps({
                clearInfiniteRows: false,
            });
        }

        if (this.isDatasourceLoadedForInfiniteScrolling()) {
            const {rowData, rowCount} = this.props.getRowsResponse;
            this.getRowsParams.successCallback(rowData, rowCount);
        }

        if (
            masterDetail &&
            !detailCellRendererParams.suppressCallback &&
            getDetailResponse
        ) {
            this.getDetailParams.successCallback(getDetailResponse);
            setProps({getDetailResponse: null});
        }
        // Call the API to select rows unless the update was triggered by a selection made in the UI
        if (
            !equals(selectedRows, prevProps.selectedRows) &&
            !this.selectionEventFired
        ) {
            this.setSelection(selectedRows);
        }

        if (JSON.stringify(cellStyle) !== JSON.stringify(prevProps.cellStyle) ||
         JSON.stringify(this.props.columnDefs) !== JSON.stringify(prevProps.columnDefs) ||
        prevProps.columnSize !== columnSize) {
            this.props.setProps({columnDefs: JSON.parse(JSON.stringify(this.props.columnDefs))})
            this.setState({origColumnDefs: JSON.parse(JSON.stringify(this.props.columnDefs))})
            this.setUpCols(cellStyle)
            this.updateColumnWidths()
        }

        if (dashGridOptions !== prevProps.dashGridOptions) {
            this.props.setProps(JSON.parse(JSON.stringify({...omit(['cellClassRules', 'rowClassRules'], this.props.dashGridOptions)})))
        }

        // Reset selection event flag
        this.selectionEventFired = false;

    }

    onRowDataUpdated() {
        // Handles preserving existing selections when rowData is updated in a callback
        const {selectedRows} = this.props;
        const {openGroups, filterModel} = this.state;

        // Call the API to select rows
        this.setSelection(selectedRows);
        // When the rowData is updated, reopen any row groups if they previously existed in the table
        // Iterate through all nodes in the grid. Unfortunately there's no way to iterate through only nodes representing groups
        if (openGroups.size > 0) {
            this.state.gridApi.forEachNode((node) => {
                // Check if it's a group row based on whether it has the __hasChildren prop
                if (node.__hasChildren) {
                    // If the key for the node (i.e. the group name) is the same as an
                    if (openGroups.has(node.key)) {
                        this.state.gridApi.setRowNodeExpanded(node, true);
                    }
                }
            });
        }
        if (!isEmpty(filterModel)) {
            this.state.gridApi.setFilterModel(filterModel);
        }
    }

    onRowGroupOpened(e) {
        const {openGroups} = this.state;

        if (e.expanded) {
            // If the node was just expanded, add it to the list of open nodes
            openGroups.add(e.node.key);
        } else {
            // If it's collapsed, remove it from the list of open nodes
            openGroups.delete(e.node.key);
        }
        this.setState({openGroups: openGroups});
    }

    onSelectionChanged() {
        // Flag that the selection event was fired
        this.selectionEventFired = true;
        const selectedRows = this.state.gridApi.getSelectedRows();
        this.props.setProps({selectedRows});
    }

    isDatasourceLoadedForInfiniteScrolling() {
        return (
            this.props.rowModelType === 'infinite' &&
            this.getRowsParams &&
            this.props.getRowsResponse
        );
    }

    getDatasource() {
        const self = this;

        return {
            getRows(params) {
                self.getRowsParams = params;
                self.props.setProps({getRowsRequest: params});
            },

            destroy() {
                self.getRowsParams = null;
            },
        };
    }

    applyRowTransaction(data, gridApi = this.state.gridApi) {
        if (data.async === false) {
            gridApi.applyTransaction(data)
        } else {
            gridApi.applyTransactionAsync(data)
        }
    }

    onGridReady(params) {
        // Applying Infinite Row Model
        // see: https://www.ag-grid.com/javascript-grid/infinite-scrolling/
        const {rowModelType, selectedRows} = this.props;
        if (rowModelType === 'infinite') {
            params.api.setDatasource(this.getDatasource());
        }

        this.setState({
            gridApi: params.api,
            gridColumnApi: params.columnApi,
        });

        this.updateColumnWidths()

        if (this.state.rowTransaction) {
            this.state.rowTransaction.map((data) => this.applyRowTransaction(data, params.api))
            this.setState({rowTransaction: null});
            this.props.setProps({rowData: this.getRowData()})
        }

        // Handles applying selections when a selection was persisted by Dash
        this.setSelection(selectedRows);
        this.props.setProps({gridReady: true});
        // Hydrate virtualRowData
        this.onFilterChanged(true);

    }

    onCellClicked({value, column: {colId}, rowIndex}) {
        const timestamp = Date.now()
        this.props.setProps({cellClicked: {value, colId, rowIndex, timestamp}});
    }

    onCellValueChanged({oldValue, newValue, column: {colId}, rowIndex, data, node}) {
        const nodeId = JSON.parse(JSON.stringify(node.id))
        this.props.setProps({
            cellValueChanged: {rowIndex, nodeId, data, oldValue, newValue, colId},
        });
    }

    onDisplayedColumnsChanged() {
        // this.updateColumnWidths();
    }

    onGridSizeChanged() {
        // this.updateColumnWidths();
    }

    updateColumnWidths() {
        if (this.state.gridApi || this.state.gridColumnApi) {
            if (this.props.columnSize === 'autoSizeAll') {
                this.state.gridColumnApi.autoSizeAllColumns(false);
            } else if (this.props.columnSize === 'sizeToFit') {
                this.state.gridApi.sizeColumnsToFit();
            }
        }
    }

    evaluateFunction = (tempFunction, params) => {
        const parsedCondition = esprima.parse(tempFunction).body[0]
                    .expression;
        const value = evaluate(parsedCondition, {params, d3, ...customFunctions, ...window.dashAgGridFunctions,
        ...window.dashSharedVariables})
        return value
    }

    /**
     * @params AG-Grid Styles rules attribute.
     * See: https://www.ag-grid.com/react-grid/cell-styles/#cell-style-cell-class--cell-class-rules-params
     */
    handleDynamicCellStyle({params, cellStyle = {}}) {
        const {styleConditions, defaultStyle} = cellStyle;

        if (styleConditions && styleConditions.length > 0) {
            for (const styleCondition of styleConditions) {
                const {condition, style} = styleCondition;

                if (this.evaluateFunction(condition, params)) {
                    return style;
                }
            }
        }

        return defaultStyle ? defaultStyle : null;
    }

    /**
     * @params AG-Grid Styles rules attribute.
     * See: https://www.ag-grid.com/react-grid/row-styles/#row-style-row-class--row-class-rules-params
     */
    handleDynamicRowStyle({params, getRowStyle = {}}) {
        const {styleConditions, defaultStyle} = getRowStyle;

        if (styleConditions && styleConditions.length > 0) {
            for (const styleCondition of styleConditions) {
                const {condition, style} = styleCondition;

                if (this.evaluateFunction(condition, params)) {
                    return style;
                }
            }
        }

        return defaultStyle ? defaultStyle : null;
    }

    parseParamFunction(params, tempFunction) {
        try {
            return this.evaluateFunction(tempFunction, params)
        } catch (err) {
            console.log(err)
        }
        return ''
    }

    generateRenderer(Renderer) {
        const {setProps, dangerously_allow_code} = this.props;

        const setCellProps = (props) => {
            setProps({clickData: props.clickData, hoverData: props.hoverData});
        };

        return (props) => (
            <Renderer setProps={setCellProps} dangerously_allow_code={dangerously_allow_code} {...props}></Renderer>
        );
    }

    resetColumnState() {
        this.state.gridColumnApi.resetColumnState();
        this.props.setProps({
            resetColumnState: false,
        });
    }

    exportDataAsCsv(csvExportParams) {
        this.state.gridApi.exportDataAsCsv(csvExportParams);
        this.props.setProps({
            exportDataAsCsv: false,
        });
    }

    selectAll() {
        this.state.gridApi.selectAll()
        this.props.setProps({
            selectAll: false,
        });
    }

    selectAllFiltered() {
        this.state.gridApi.selectAllFiltered()
        this.props.setProps({
            selectAllFiltered: false,
        });
    }

    deselectAll() {
        this.state.gridApi.deselectAll()
        this.props.setProps({
            deselectAll: false,
        });
    }

    deleteSelectedRows() {
        const sel = this.state.gridApi.getSelectedRows();
        this.state.gridApi.applyTransaction({remove: sel});
        this.props.setProps({
            deleteSelectedRows: false,
            rowData: this.getRowData()
        });
    }

    buildArray(arr1, arr2) {
        if (arr1) {
            if (!(JSON.parse(JSON.stringify(arr1)).includes(JSON.parse(JSON.stringify(arr2))))) {
                return [...arr1, arr2];
            }
            return arr1;
        }
        return [JSON.parse(JSON.stringify(arr2))];
    }

    rowTransaction(data) {
        if (this.state.mounted) {
            if (this.state.gridApi) {
                if (this.state.rowTransaction) {
                    this.state.rowTransaction.map((data) => this.applyRowTransaction(data))
                    this.setState({rowTransaction: null});
                }
                this.applyRowTransaction(data)
                this.props.setProps({
                    rowTransaction: null,
                    rowData: this.getRowData()
                })
            } else {
                this.setState({
                    rowTransaction: this.state.rowTransaction ?
                        this.buildArray(this.state.rowTransaction, data) :
                        [JSON.parse(JSON.stringify(data))]
                })
            }
        }
    }

    autoSizeAllColumns(skipHeader) {
        const allColumnIds = [];
        this.state.gridColumnApi.getColumnState().forEach((column) => {
          allColumnIds.push(column.colId);
        });
        this.state.gridColumnApi.autoSizeColumns(allColumnIds, skipHeader);
        this.props.setProps({
            autoSizeAllColumns: false,
            autoSizeAllColumnsSkipHeaders: false,
        });
    };

    updateColumnState () {
        this.props.setProps({
            columnState: JSON.parse(JSON.stringify(this.state.gridColumnApi.getColumnState())),
            updateColumnState: false
        })
    }

    render() {
        const {
            id,
            cellStyle,
            getRowStyle,
            style,
            theme,
            className,
            resetColumnState,
            exportDataAsCsv,
            selectAll,
            selectAllFiltered,
            deselectAll,
            autoSizeAllColumns,
            autoSizeAllColumnsSkipHeaders,
            deleteSelectedRows,
            rowTransaction,
            updateColumnState,
            csvExportParams,
            detailCellRendererParams,
            setProps,
            dangerously_allow_code,
            dashGridOptions,
            ...restProps
        } = this.props;

        const replaceFunc = (target) => {
            const shouldWarn = !dangerously_allow_code && expressWarn.includes(target);

            const sanitize = (container) => {
                const targetIn = container[target];
                if (targetIn) {
                    if(shouldWarn && (typeof targetIn === 'string')) {
                        container[target] = () => '';
                        console.error({
                            prop: target,
                            message: 'you are trying to use an unsafe prop without dangerously_allow_code'
                        })
                    }
                    else if ((typeof targetIn === 'object') && ('function' in targetIn)
                    && !replaceFunctions.includes(target)) {
                        const newFunc = JSON.parse(JSON.stringify(container[target]['function']))
                        container[target] = (params) => this.parseParamFunction(params, newFunc)
                    }
                    if (replaceFunctions.includes(target)) {
                        for (const [key, value] of Object.entries(container[target])) {
                            if (typeof value !== 'function') {
                                container[target][key] = (params) => this.parseParamFunction(params, value)
                            }
                        }
                    }
                }
            }

            sanitize(this.props);
            if (dashGridOptions) {
                sanitize(dashGridOptions);
            }
        }

        gridFunctions.map(replaceFunc)

        let getRowId;
        if (this.props.getRowId) {
            getRowId = (params) => this.parseParamFunction(params, JSON.parse(JSON.stringify(this.props.getRowId)))
        }

        this.setUpCols(cellStyle)

        let newRowStyle;
        if (getRowStyle) {
            newRowStyle = (params) => this.handleDynamicRowStyle({params, getRowStyle})
        }

        if (resetColumnState) {
            this.resetColumnState();
        }

        if (exportDataAsCsv) {
            this.exportDataAsCsv(csvExportParams);
        }

        if (selectAll) {
            this.selectAll();
        }

        if (selectAllFiltered) {
            this.selectAllFiltered();
        }

        if (deselectAll) {
            this.deselectAll();
        }

        if (autoSizeAllColumns) {
            this.autoSizeAllColumns(false);
        }

        if (autoSizeAllColumnsSkipHeaders) {
            this.autoSizeAllColumns(true);
        }

        if (updateColumnState) {
            this.updateColumnState();
        }

        if (deleteSelectedRows) {
            this.deleteSelectedRows();
        }

        if (rowTransaction) {
            this.rowTransaction(rowTransaction);
        }

        const callbackGetDetail = (params) => {
            const {data} = params;
            this.getDetailParams = params;
            // Adding the current time in ms forces Dash to trigger a callback
            // when the same row is closed and re-opened.
            setProps({getDetailRequest: {data: data, requestTime: Date.now()}});
        };

        function suppressGetDetail(colName) {
            return (params) => {
                params.successCallback(params.data[colName]);
            };
        }

        let newDetailCellRendererParams = null;
        if (this.props.masterDetail) {
            newDetailCellRendererParams = {
                ...omit(
                    ['detailColName', 'suppressCallback'],
                    detailCellRendererParams
                ),
                getDetailRowData: detailCellRendererParams.suppressCallback
                    ? suppressGetDetail(detailCellRendererParams.detailColName)
                    : callbackGetDetail,
            };
        }

        return (
            <div
                id={id}
                className={theme ? 'ag-theme-' + theme : className}
                style={{
                    ...style,
                }}
            >
                <AgGridReact
                    getRowId={getRowId}
                    getRowStyle={newRowStyle}
                    onGridReady={this.onGridReady}
                    onSelectionChanged={this.onSelectionChanged}
                    onCellClicked={this.onCellClicked}
                    onCellValueChanged={this.onCellValueChanged}
                    onFilterChanged={this.onFilterChanged}
                    onSortChanged={this.onSortChanged}
                    onRowDataUpdated={this.onRowDataUpdated}
                    onRowGroupOpened={this.onRowGroupOpened}
                    onDisplayedColumnsChanged={this.onDisplayedColumnsChanged}
                    onGridSizeChanged={debounce(this.onGridSizeChanged, RESIZE_DEBOUNCE_MS)}
                    components={this.state.components}
                    detailCellRendererParams={newDetailCellRendererParams}
                    {...dashGridOptions}
                    {...omit(['theme', 'getRowId'], restProps)}
                >
                </AgGridReact>
            </div>
        );
    };
}

DashAgGrid.defaultProps = _defaultProps;
DashAgGrid.propTypes = {parentState: PropTypes.any, ..._propTypes};

export const propTypes = DashAgGrid.propTypes;
export const defaultProps = DashAgGrid.defaultProps;
